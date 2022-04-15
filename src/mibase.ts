import * as DebugAdapter from 'vscode-debugadapter';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, ThreadEvent, OutputEvent, ContinuedEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Breakpoint, IBackend, Variable, VariableObject, ValuesFormattingMode, MIError } from './backend/backend';
import { MINode } from './backend/mi_parse';
import { expandValue, isExpandable } from './backend/gdb_expansion';
import { MI2 } from './backend/mi2/mi2';
import { posix } from "path";
import * as systemPath from "path";
import * as net from "net";
import * as os from "os";
import * as fs from "fs";

class ExtendedVariable {
	constructor(public name, public options) {
	}
}

export enum RunCommand { CONTINUE, RUN, NONE }

const STACK_HANDLES_START = 1000;
const VAR_HANDLES_START = 512 * 256 + 1000;

export class MI2DebugSession extends DebugSession {
	protected variableHandles = new Handles<string | VariableObject | ExtendedVariable>(VAR_HANDLES_START);
	protected variableHandlesReverse: { [id: string]: number } = {};
	protected useVarObjects: boolean;
	protected quit: boolean;
	protected attached: boolean;
	protected initialRunCommand: RunCommand;
	protected stopAtEntry: boolean | string;
	protected isSSH: boolean;
	protected sourceFileMap: Map<string,string>;
	protected started: boolean;
	protected crashed: boolean;
	protected miDebugger: MI2;
	protected commandServer: net.Server;
	protected serverPath: string;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
	}

	protected initDebugger() {
		this.miDebugger.on("launcherror", this.launchError.bind(this));
		this.miDebugger.on("quit", this.quitEvent.bind(this));
		this.miDebugger.on("exited-normally", this.quitEvent.bind(this));
		this.miDebugger.on("stopped", this.stopEvent.bind(this));
		this.miDebugger.on("msg", this.handleMsg.bind(this));
		this.miDebugger.on("breakpoint", this.handleBreakpoint.bind(this));
		this.miDebugger.on("watchpoint", this.handleBreak.bind(this));	// consider to parse old/new, too (otherwise it is in the console only)
		this.miDebugger.on("step-end", this.handleBreak.bind(this));
		// this.miDebugger.on("step-out-end", this.handleBreak.bind(this));  // was combined into step-end
		this.miDebugger.on("step-other", this.handleBreak.bind(this));
		this.miDebugger.on("signal-stop", this.handlePause.bind(this));
		this.miDebugger.on("thread-created", this.threadCreatedEvent.bind(this));
		this.miDebugger.on("thread-exited", this.threadExitedEvent.bind(this));
		this.miDebugger.once("debug-ready", (() => this.sendEvent(new InitializedEvent())));
		try {
			this.commandServer = net.createServer(c => {
				c.on("data", data => {
					const rawCmd = data.toString();
					const spaceIndex = rawCmd.indexOf(" ");
					let func = rawCmd;
					let args = [];
					if (spaceIndex != -1) {
						func = rawCmd.substr(0, spaceIndex);
						args = JSON.parse(rawCmd.substr(spaceIndex + 1));
					}
					Promise.resolve(this.miDebugger[func].apply(this.miDebugger, args)).then(data => {
						c.write(data.toString());
					});
				});
			});
			this.commandServer.on("error", err => {
				if (process.platform != "win32")
					this.handleMsg("stderr", "Code-Debug WARNING: Utility Command Server: Error in command socket " + err.toString() + "\nCode-Debug WARNING: The examine memory location command won't work");
			});
			if (!fs.existsSync(systemPath.join(os.tmpdir(), "code-debug-sockets")))
				fs.mkdirSync(systemPath.join(os.tmpdir(), "code-debug-sockets"));
			this.commandServer.listen(this.serverPath = systemPath.join(os.tmpdir(), "code-debug-sockets", ("Debug-Instance-" + Math.floor(Math.random() * 36 * 36 * 36 * 36).toString(36)).toLowerCase()));
		} catch (e) {
			if (process.platform != "win32")
				this.handleMsg("stderr", "Code-Debug WARNING: Utility Command Server: Failed to start " + e.toString() + "\nCode-Debug WARNING: The examine memory location command won't work");
		}
	}

	protected setValuesFormattingMode(mode: ValuesFormattingMode) {
		switch (mode) {
			case "disabled":
				this.useVarObjects = true;
				this.miDebugger.prettyPrint = false;
				break;
			case "prettyPrinters":
				this.useVarObjects = true;
				this.miDebugger.prettyPrint = true;
				break;
			case "parseText":
			default:
				this.useVarObjects = false;
				this.miDebugger.prettyPrint = false;
		}
	}

	protected handleMsg(type: string, msg: string) {
		if (type == "target")
			type = "stdout";
		if (type == "log")
			type = "stderr";
		this.sendEvent(new OutputEvent(msg, type));
	}

	protected handleBreakpoint(info: MINode) {
		const event = new StoppedEvent("breakpoint", parseInt(info.record("thread-id")));
		(event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info.record("stopped-threads") == "all";
		this.sendEvent(event);
	}

	protected handleBreak(info?: MINode) {
		const event = new StoppedEvent("step", info ? parseInt(info.record("thread-id")) : 1);
		(event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info ? info.record("stopped-threads") == "all" : true;
		this.sendEvent(event);
	}

	protected handlePause(info: MINode) {
		const event = new StoppedEvent("user request", parseInt(info.record("thread-id")));
		(event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info.record("stopped-threads") == "all";
		this.sendEvent(event);
	}

	protected stopEvent(info: MINode) {
		if (!this.started)
			this.crashed = true;
		if (!this.quit) {
			const event = new StoppedEvent("exception", parseInt(info.record("thread-id")));
			(event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info.record("stopped-threads") == "all";
			this.sendEvent(event);
		}
	}

	protected threadCreatedEvent(info: MINode) {
		this.sendEvent(new ThreadEvent("started", info.record("id")));
	}

	protected threadExitedEvent(info: MINode) {
		this.sendEvent(new ThreadEvent("exited", info.record("id")));
	}

	protected quitEvent() {
		this.quit = true;
		this.sendEvent(new TerminatedEvent());

		if (this.serverPath)
			fs.unlink(this.serverPath, (err) => {
				console.error("Failed to unlink debug server");
			});
	}

	protected launchError(err: any) {
		this.handleMsg("stderr", "Could not start debugger process, does the program exist in filesystem?\n");
		this.handleMsg("stderr", err.toString() + "\n");
		this.quitEvent();
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		if (this.attached)
			this.miDebugger.detach();
		else
			this.miDebugger.stop();
		this.commandServer.close();
		this.commandServer = undefined;
		this.sendResponse(response);
	}

	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
		try {
			if (this.useVarObjects) {
				let name = args.name;
				if (args.variablesReference >= VAR_HANDLES_START) {
					const parent = this.variableHandles.get(args.variablesReference) as VariableObject;
					name = `${parent.name}.${name}`;
				}

				const res = await this.miDebugger.varAssign(name, args.value);
				response.body = {
					value: res.result("value")
				};
			} else {
				await this.miDebugger.changeVariable(args.name, args.value);
				response.body = {
					value: args.value
				};
			}
			this.sendResponse(response);
		} catch (err) {
			this.sendErrorResponse(response, 11, `Could not continue: ${err}`);
		}
	}

	protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
		const all = [];
		args.breakpoints.forEach(brk => {
			all.push(this.miDebugger.addBreakPoint({ raw: brk.name, condition: brk.condition, countCondition: brk.hitCondition }));
		});
		Promise.all(all).then(brkpoints => {
			const finalBrks = [];
			brkpoints.forEach(brkp => {
				if (brkp[0])
					finalBrks.push({ line: brkp[1].line });
			});
			response.body = {
				breakpoints: finalBrks
			};
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 10, msg.toString());
		});
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		this.miDebugger.clearBreakPoints(args.source.path).then(() => {
			let path = args.source.path;
			if (this.isSSH) {
				// convert local path to ssh path
				if (path.indexOf("\\") != -1)
					path = path.replace(/\\/g, "/").toLowerCase();
				// ideCWD is the local path, gdbCWD is the ssh path, both had the replacing \ -> / done up-front
				for (let [ideCWD, gdbCWD] of this.sourceFileMap) {
					if (path.startsWith(ideCWD)) {
						path = posix.relative(ideCWD, path);
						path = posix.join(gdbCWD, path); // we combined a guaranteed path with relative one (works with GDB both on GNU/Linux and Win32)
						break;
					}
				}
			}
			const all = args.breakpoints.map(brk => {
				return this.miDebugger.addBreakPoint({ file: path, line: brk.line, condition: brk.condition, countCondition: brk.hitCondition });
			});
			Promise.all(all).then(brkpoints => {
				const finalBrks = [];
				brkpoints.forEach(brkp => {
					// TODO: Currently all breakpoints returned are marked as verified,
					// which leads to verified breakpoints on a broken lldb.
					if (brkp[0])
						finalBrks.push(new DebugAdapter.Breakpoint(true, brkp[1].line));
				});
				response.body = {
					breakpoints: finalBrks
				};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 9, msg.toString());
			});
		}, msg => {
			this.sendErrorResponse(response, 9, msg.toString());
		});
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse, request: DebugProtocol.Request, retries = 5, delay = 100): void {
		if (!this.miDebugger) {
			this.sendResponse(response);
			return;
		}
		this.miDebugger.getThreads().then(threads => {
				response.body = {
					threads: []
				};
				for (const thread of threads) {
					let threadName = thread.name || thread.targetId || "<unnamed>";
					response.body.threads.push(new Thread(thread.id, thread.id + ":" + threadName));
				}
				this.sendResponse(response);
			}).catch(error => {
				if (retries > 1) {
					// If threads are requested too early after startup we may get the following error:
					// 'Cannot execute this command while the target is running. Use the interrupt command to stop the target and try again.'
					// Even without an interrupt, re-trying after some time will solve that issue in some cases.
					setTimeout(() => this.threadsRequest(response, request, retries - 1, delay), delay);
				} else {
					this.sendErrorResponse(response, 17, `Could not get threads: ${error}`);
				}
			});
	}

	// Supports 65535 threads.
	protected threadAndLevelToFrameId(threadId: number, level: number) {
		return level << 16 | threadId;
	}
	protected frameIdToThreadAndLevel(frameId: number) {
		return [frameId & 0xffff, frameId >> 16];
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.miDebugger.getStack(args.startFrame, args.levels, args.threadId).then(stack => {
			const ret: StackFrame[] = [];
			stack.forEach(element => {
				let source = undefined;
				let path = element.file;
				if (path) {
					if (this.isSSH) {
						// convert ssh path to local path
						if (path.indexOf("\\") != -1)
							path = path.replace(/\\/g, "/").toLowerCase();
						// ideCWD is the local path, gdbCWD is the ssh path, both had the replacing \ -> / done up-front
						for (let [ideCWD, gdbCWD] of this.sourceFileMap) {
							if (path.startsWith(gdbCWD)) {
								path = posix.relative(gdbCWD, path);	// only operates on "/" paths
								path = systemPath.resolve(ideCWD, path);	// will do the conversion to "\" on Win32
								break;
							}
						}
					} else if (process.platform === "win32") {
						if (path.startsWith("\\cygdrive\\") || path.startsWith("/cygdrive/")) {
							path = path[10] + ":" + path.substr(11); // replaces /cygdrive/c/foo/bar.txt with c:/foo/bar.txt
						}
					}
					source = new Source(element.fileName, path);
				}

				ret.push(new StackFrame(
					this.threadAndLevelToFrameId(args.threadId, element.level),
					element.function + "@" + element.address,
					source,
					element.line,
					0));
			});
			response.body = {
				stackFrames: ret
			};
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`);
		});
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		const promises: Thenable<any>[] = [];
		let entryPoint: string | undefined = undefined;
		let runToStart: boolean = false;
		// Setup temporary breakpoint for the entry point if needed.
		switch (this.initialRunCommand) {
			case RunCommand.CONTINUE:
			case RunCommand.NONE:
				if (typeof this.stopAtEntry == 'boolean' && this.stopAtEntry)
					entryPoint = "main"; // sensible default
				else if (typeof this.stopAtEntry == 'string')
					entryPoint = this.stopAtEntry;
				break;
			case RunCommand.RUN:
				if (typeof this.stopAtEntry == 'boolean' && this.stopAtEntry) {
					if (this.miDebugger.features.includes("exec-run-start-option"))
						runToStart = true;
					else
						entryPoint = "main"; // sensible fallback
				} else if (typeof this.stopAtEntry == 'string')
					entryPoint = this.stopAtEntry;
				break;
			default:
				throw new Error('Unhandled run command: ' + RunCommand[this.initialRunCommand]);
		}
		if (entryPoint)
			promises.push(this.miDebugger.setEntryBreakPoint(entryPoint));
		switch (this.initialRunCommand) {
			case RunCommand.CONTINUE:
				promises.push(this.miDebugger.continue().then(() => {
					// Some debuggers will provide an out-of-band status that they are stopped
					// when attaching (e.g., gdb), so the client assumes we are stopped and gets
					// confused if we start running again on our own.
					//
					// If we don't send this event, the client may start requesting data (such as
					// stack frames, local variables, etc.) since they believe the target is
					// stopped.  Furthermore the client may not be indicating the proper status
					// to the user (may indicate stopped when the target is actually running).
					this.sendEvent(new ContinuedEvent(1, true));
				}));
				break;
			case RunCommand.RUN:
				promises.push(this.miDebugger.start(runToStart).then(() => {
					this.started = true;
					if (this.crashed)
						this.handlePause(undefined);
				}));
				break;
			case RunCommand.NONE:
				// Not all debuggers seem to provide an out-of-band status that they are stopped
				// when attaching (e.g., lldb), so the client assumes we are running and gets
				// confused when we don't actually run or continue.  Therefore, we'll force a
				// stopped event to be sent to the client (just in case) to synchronize the state.
				const event: DebugProtocol.StoppedEvent = new StoppedEvent("pause", 1);
				event.body.description = "paused on attach";
				event.body.allThreadsStopped = true;
				this.sendEvent(event);
				break;
			default:
				throw new Error('Unhandled run command: ' + RunCommand[this.initialRunCommand]);
		}
		Promise.all(promises).then(() => {
			this.sendResponse(response);
		}).catch(err => {
			this.sendErrorResponse(response, 18, `Could not run/continue: ${err.toString()}`);
		});
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", STACK_HANDLES_START + (parseInt(args.frameId as any) || 0), false));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		const variables: DebugProtocol.Variable[] = [];
		let id: number | string | VariableObject | ExtendedVariable;
		if (args.variablesReference < VAR_HANDLES_START) {
			id = args.variablesReference - STACK_HANDLES_START;
		} else {
			id = this.variableHandles.get(args.variablesReference);
		}

		const createVariable = (arg, options?) => {
			if (options)
				return this.variableHandles.create(new ExtendedVariable(arg, options));
			else
				return this.variableHandles.create(arg);
		};

		const findOrCreateVariable = (varObj: VariableObject): number => {
			let id: number;
			if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
				id = this.variableHandlesReverse[varObj.name];
			} else {
				id = createVariable(varObj);
				this.variableHandlesReverse[varObj.name] = id;
			}
			return varObj.isCompound() ? id : 0;
		};

		if (typeof id == "number") {
			let stack: Variable[];
			try {
				const [threadId, level] = this.frameIdToThreadAndLevel(id);
				stack = await this.miDebugger.getStackVariables(threadId, level);
				for (const variable of stack) {
					if (this.useVarObjects) {
						try {
							const varObjName = `var_${id}_${variable.name}`;
							let varObj: VariableObject;
							try {
								const changes = await this.miDebugger.varUpdate(varObjName);
								const changelist = changes.result("changelist");
								changelist.forEach((change) => {
									const name = MINode.valueOf(change, "name");
									const vId = this.variableHandlesReverse[name];
									const v = this.variableHandles.get(vId) as any;
									v.applyChanges(change);
								});
								const varId = this.variableHandlesReverse[varObjName];
								varObj = this.variableHandles.get(varId) as any;
							} catch (err) {
								if (err instanceof MIError && err.message == "Variable object not found") {
									varObj = await this.miDebugger.varCreate(variable.name, varObjName);
									const varId = findOrCreateVariable(varObj);
									varObj.exp = variable.name;
									varObj.id = varId;
								} else {
									throw err;
								}
							}
							variables.push(varObj.toProtocolVariable());
						} catch (err) {
							variables.push({
								name: variable.name,
								value: `<${err}>`,
								variablesReference: 0
							});
						}
					} else {
						if (variable.valueStr !== undefined) {
							let expanded = expandValue(createVariable, `{${variable.name}=${variable.valueStr})`, "", variable.raw);
							if (expanded) {
								if (typeof expanded[0] == "string")
									expanded = [
										{
											name: "<value>",
											value: prettyStringArray(expanded),
											variablesReference: 0
										}
									];
								variables.push(expanded[0]);
							}
						} else
							variables.push({
								name: variable.name,
								type: variable.type,
								value: "<unknown>",
								variablesReference: createVariable(variable.name)
							});
					}
				}
				response.body = {
					variables: variables
				};
				this.sendResponse(response);
			} catch (err) {
				this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
			}
		} else if (typeof id == "string") {
			// Variable members
			let variable;
			try {
				// TODO: this evals on an (effectively) unknown thread for multithreaded programs.
				variable = await this.miDebugger.evalExpression(JSON.stringify(id), 0, 0);
				try {
					let expanded = expandValue(createVariable, variable.result("value"), id, variable);
					if (!expanded) {
						this.sendErrorResponse(response, 2, `Could not expand variable`);
					} else {
						if (typeof expanded[0] == "string")
							expanded = [
								{
									name: "<value>",
									value: prettyStringArray(expanded),
									variablesReference: 0
								}
							];
						response.body = {
							variables: expanded
						};
						this.sendResponse(response);
					}
				} catch (e) {
					this.sendErrorResponse(response, 2, `Could not expand variable: ${e}`);
				}
			} catch (err) {
				this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
			}
		} else if (typeof id == "object") {
			if (id instanceof VariableObject) {
				// Variable members
				let children: VariableObject[];
				try {
					children = await this.miDebugger.varListChildren(id.name);
					const vars = children.map(child => {
						const varId = findOrCreateVariable(child);
						child.id = varId;
						return child.toProtocolVariable();
					});

					response.body = {
						variables: vars
					};
					this.sendResponse(response);
				} catch (err) {
					this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
				}
			} else if (id instanceof ExtendedVariable) {
				const varReq = id;
				if (varReq.options.arg) {
					const strArr = [];
					let argsPart = true;
					let arrIndex = 0;
					const submit = () => {
						response.body = {
							variables: strArr
						};
						this.sendResponse(response);
					};
					const addOne = async () => {
						// TODO: this evals on an (effectively) unknown thread for multithreaded programs.
						const variable = await this.miDebugger.evalExpression(JSON.stringify(`${varReq.name}+${arrIndex})`), 0, 0);
						try {
							const expanded = expandValue(createVariable, variable.result("value"), varReq.name, variable);
							if (!expanded) {
								this.sendErrorResponse(response, 15, `Could not expand variable`);
							} else {
								if (typeof expanded == "string") {
									if (expanded == "<nullptr>") {
										if (argsPart)
											argsPart = false;
										else
											return submit();
									} else if (expanded[0] != '"') {
										strArr.push({
											name: "[err]",
											value: expanded,
											variablesReference: 0
										});
										return submit();
									}
									strArr.push({
										name: `[${(arrIndex++)}]`,
										value: expanded,
										variablesReference: 0
									});
									addOne();
								} else {
									strArr.push({
										name: "[err]",
										value: expanded,
										variablesReference: 0
									});
									submit();
								}
							}
						} catch (e) {
							this.sendErrorResponse(response, 14, `Could not expand variable: ${e}`);
						}
					};
					addOne();
				} else
					this.sendErrorResponse(response, 13, `Unimplemented variable request options: ${JSON.stringify(varReq.options)}`);
			} else {
				response.body = {
					variables: id
				};
				this.sendResponse(response);
			}
		} else {
			response.body = {
				variables: variables
			};
			this.sendResponse(response);
		}
	}

	protected pauseRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.miDebugger.interrupt().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 3, `Could not pause: ${msg}`);
		});
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
		this.miDebugger.continue(true).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
		});
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.miDebugger.continue().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
		});
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this.miDebugger.step(true).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 4, `Could not step back: ${msg} - Try running 'target record-full' before stepping back`);
		});
	}

	protected stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.step().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 4, `Could not step in: ${msg}`);
		});
	}

	protected stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.stepOut().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 5, `Could not step out: ${msg}`);
		});
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.next().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
		});
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		const [threadId, level] = this.frameIdToThreadAndLevel(args.frameId);
		if (args.context == "watch" || args.context == "hover") {
			this.miDebugger.evalExpression(args.expression, threadId, level).then((res) => {
				response.body = {
					variablesReference: 0,
					result: res.result("value")
				};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 7, msg.toString());
			});
		} else {
			this.miDebugger.sendUserInput(args.expression, threadId, level).then(output => {
				if (typeof output == "undefined")
					response.body = {
						result: "",
						variablesReference: 0
					};
				else
					response.body = {
						result: JSON.stringify(output),
						variablesReference: 0
					};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 8, msg.toString());
			});
		}
	}

	protected gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments): void {
		this.miDebugger.goto(args.source.path, args.line).then(done => {
			response.body = {
				targets: [{
					id: 1,
					label: args.source.name,
					column: args.column,
					line : args.line
				}]
			};
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 16, `Could not jump: ${msg}`);
		});
	}

	protected gotoRequest(response: DebugProtocol.GotoResponse, args: DebugProtocol.GotoArguments): void {
		this.sendResponse(response);
	}

	private addSourceFileMapEntry(gdbCWD :string, ideCWD : string): void {
		// if it looks like a Win32 path convert to "/"-style for comparisions and to all-lower-case
		if (ideCWD.indexOf("\\") != -1)
			ideCWD = ideCWD.replace(/\\/g, "/").toLowerCase();
		if (!ideCWD.endsWith("/"))
			ideCWD = ideCWD + "/"
		// ensure that we only replace complete paths
		if (gdbCWD.indexOf("\\") != -1)
			gdbCWD = gdbCWD.replace(/\\/g, "/").toLowerCase();
		if (!gdbCWD.endsWith("/"))
			gdbCWD = gdbCWD + "/"
		this.sourceFileMap.set(ideCWD, gdbCWD);
	}

	protected setSourceFileMap(configMap: { [index: string]: string }, fallbackGDB :string, fallbackIDE : string): void {
		this.sourceFileMap = new Map<string, string>();
		if (configMap === undefined) {
			this.addSourceFileMapEntry(fallbackGDB, fallbackIDE);
		} else {
			for (let [gdbPath, localPath] of Object.entries(configMap)) {
				this.addSourceFileMapEntry(gdbPath, localPath);
			}
		}
	}

}

function prettyStringArray(strings) {
	if (typeof strings == "object") {
		if (strings.length !== undefined)
			return strings.join(", ");
		else
			return JSON.stringify(strings);
	} else return strings;
}
