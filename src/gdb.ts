import { MI2DebugSession } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { escape } from "./backend/mi_parse"
import { MI2 } from "./backend/mi2/mi2";
import { SSHArguments } from './backend/backend';

export interface CommonRequestArguments {
	cwd: string;
	target: string;
	gdbpath: string;
	debugger_args: string[];
	autorunBefore: string[];
	autorun: string[];
	ssh: SSHArguments;
	printCalls: boolean;
	showDevDebugOutput: boolean;
	executable: string;
	remote: boolean;
	arguments: string;
	terminal: string;
}

export interface LaunchRequestArguments extends CommonRequestArguments { }
export interface AttachRequestArguments extends CommonRequestArguments { }

class GDBDebugSession extends MI2DebugSession {
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsHitConditionalBreakpoints = true;
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsFunctionBreakpoints = true;
		response.body.supportsEvaluateForHovers = true;
		response.body.supportsSetVariable = true;
		response.body.supportsStepBack = true;
		this.sendResponse(response);
	}


	private initiliaseDefaultValueArgs(args: CommonRequestArguments, attach: boolean) {
		this.quit = false;
		this.attached = false;
		this.needContinue = false;
		this.isSSH = false;
		this.started = false;
		this.crashed = false;
		this.debugReady = false;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		var hasAutorunBeforeArgs = args.autorunBefore !== undefined;


		if (args.ssh !== undefined) {
			if (args.ssh.forwardX11 === undefined)
				args.ssh.forwardX11 = true;
			if (args.ssh.port === undefined)
				args.ssh.port = 22;
			if (args.ssh.x11port === undefined)
				args.ssh.x11port = 6000;
			if (args.ssh.x11host === undefined)
				args.ssh.x11host = "localhost";
			if (args.ssh.remotex11screen === undefined)
				args.ssh.remotex11screen = 0;
			this.isSSH = true;
			this.trimCWD = args.cwd.replace(/\\/g, "/");
			this.switchCWD = args.ssh.cwd;
		}
		if (args.autorun === undefined)
			args.autorun = [];

		if (!hasAutorunBeforeArgs)
			args.autorunBefore = ["gdb-set target-async on",
				"environment-directory \"$cwd\""];

		if (attach) {
			this.attached = !args.remote;
			if (!hasAutorunBeforeArgs)
				args.autorunBefore.push("target-select remote $target");

		} else {
			this.attached = false;
			this.needContinue = true;
			if (!hasAutorunBeforeArgs)
				args.autorunBefore.push("target-select $target");
		}
		args.autorun = args.autorun.map(
			s => {return escape(s);
		});

		args.autorunBefore = args.autorunBefore.map(
			s => {return s.replace(/\$cwd/, escape(args.cwd))
				.replace(/\$target/, args.target);
		});
	}



	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.miDebugger = new MI2(args.gdbpath || "gdb", ["-q", "--interpreter=mi2"], args.debugger_args);
		this.initDebugger();
		this.initiliaseDefaultValueArgs(args, false);

		if (this.isSSH) {
			this.miDebugger.ssh(args.ssh, args.ssh.cwd, args.target, args.autorunBefore, args.arguments, args.terminal, false).then(() => {
				args.autorun.forEach(command => {
					this.miDebugger.sendUserInput(command);
				});
				setTimeout(() => {
					this.miDebugger.emit("ui-break-done");
				}, 50);
				this.sendResponse(response);
				this.miDebugger.start().then(() => {
					this.started = true;
					if (this.crashed)
						this.handlePause(undefined);
				}, err => {
					this.sendErrorResponse(response, 100, `Failed to start MI Debugger: ${err.toString()}`)
				});
			}, err => {
				this.sendErrorResponse(response, 102, `Failed to SSH: ${err.toString()}`)
			});
		}
		else {
			this.miDebugger.load(args.cwd, args.target, args.autorunBefore, args.arguments, args.terminal).then(() => {
				args.autorun.forEach(command => {
					this.miDebugger.sendUserInput(command);
				});
				setTimeout(() => {
					this.miDebugger.emit("ui-break-done");
				}, 50);
				this.sendResponse(response);
				this.miDebugger.start().then(() => {
					this.started = true;
					if (this.crashed)
						this.handlePause(undefined);
				}, err => {
					this.sendErrorResponse(response, 100, `Failed to Start MI Debugger: ${err.toString()}`)
				});
			}, err => {
				this.sendErrorResponse(response, 103, `Failed to load MI Debugger: ${err.toString()}`)
			});
		}
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		this.miDebugger = new MI2(args.gdbpath || "gdb", ["-q", "--interpreter=mi2"], args.debugger_args);
		this.initDebugger();
		this.initiliaseDefaultValueArgs(args, true);



		if (this.isSSH) {
			this.miDebugger.ssh(args.ssh, args.ssh.cwd, args.target, args.autorunBefore, "", undefined, true).then(() => {
				args.autorun.forEach(command => {
					this.miDebugger.sendUserInput(command);
				});
				setTimeout(() => {
					this.miDebugger.emit("ui-break-done");
				}, 50);
				this.sendResponse(response);
			}, err => {
				this.sendErrorResponse(response, 102, `Failed to SSH: ${err.toString()}`)
			});
		}
		else {
			if (args.remote) {
				this.miDebugger.connect(args.cwd, args.executable, args.target, args.autorunBefore).then(() => {
					args.autorun.forEach(command => {
						this.miDebugger.sendUserInput(command);
					});
					this.sendResponse(response);
				}, err => {
					this.sendErrorResponse(response, 102, `Failed to attach: ${err.toString()}`)
				});
			}
			else {
				this.miDebugger.attach(args.cwd, args.executable, args.target, args.autorunBefore).then(() => {
					args.autorun.forEach(command => {
						this.miDebugger.sendUserInput(command);
					});
					this.sendResponse(response);
				}, err => {
					this.sendErrorResponse(response, 101, `Failed to attach: ${err.toString()}`)
				});
			}
		}
	}
}

DebugSession.run(GDBDebugSession);