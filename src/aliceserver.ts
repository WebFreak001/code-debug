// Manages a debugging session using Aliceserver.
//
// This imports and uses the MI2_ALICE class to manage its session using
// supported commands.

import { MI2DebugSession, RunCommand } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2_ALICE } from "./backend/mi2/mi2aliceserver";
import { SSHArguments, ValuesFormattingMode } from './backend/backend';
import { execSync } from 'child_process'; // Temporary import

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	cwd: string;
	target: string;
	target_arguments: string;
	aliceserver_path: string;
	env: any;
	debugger_args: string[];
	autorun: string[];
	stopAtEntry: boolean | string;
	ssh: SSHArguments;
	valuesFormatting: ValuesFormattingMode;
	printCalls: boolean;
	showDevDebugOutput: boolean;
}

export interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	cwd: string;
	target: string;
	aliceserver_path: string;
	env: any;
	debugger_args: string[];
	executable: string;
	autorun: string[];
	stopAtConnect: boolean;
	stopAtEntry: boolean | string;
	printCalls: boolean;
	showDevDebugOutput: boolean;
}

class AliceserverDebugSession extends MI2DebugSession {
	protected override initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsGotoTargetsRequest = false;
		response.body.supportsHitConditionalBreakpoints = false;
		response.body.supportsConfigurationDoneRequest = false;
		response.body.supportsConditionalBreakpoints = false;
		response.body.supportsFunctionBreakpoints = false;
		response.body.supportsEvaluateForHovers = false;
		this.sendResponse(response);
	}

	// NOTE: Temporary fix that allows absolute executable paths outside of PATH
	//       Until Aliceserver is fully implemented.
	//       This fix bypasses the PATH check (performed by Windows' WHERE and
	//       POSIX's command(1)) by directly invoking the compiler.
	protected checkCommand(debuggerName: string): boolean {
		try {
			execSync(`${debuggerName} --version`, { stdio: 'ignore' });
			return true;
		} catch (error) {
			return false;
		}
	}

	protected override launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		const dbgCommand = args.aliceserver_path || "aliceserver";
		if (args.aliceserver_path === undefined && this.checkCommand(dbgCommand)) {
			this.sendErrorResponse(response, 104, `Configured debugger ${dbgCommand} not found.`);
			return;
		}

		this.miDebugger = new MI2_ALICE(dbgCommand, [ "-a", "mi" ], args.debugger_args, args.env);
		this.initDebugger();

		// Defaults
		this.quit = false;
		this.attached = false;
		this.initialRunCommand = RunCommand.RUN;
		this.isSSH = false;
		this.started = false;
		this.crashed = false;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.stopAtEntry = args.stopAtEntry;

		// Initiate session
		this.isSSH = args.ssh !== undefined;
		if (this.isSSH) {
			// Set defaults if these are unset
			args.ssh.forwardX11 		??= true;
			args.ssh.port 				??= 22;
			args.ssh.x11port 			??= 6000;
			args.ssh.x11host 			??= "localhost";
			args.ssh.remotex11screen 	??= 0;
			
			this.setSourceFileMap(args.ssh.sourceFileMap, args.ssh.cwd, args.cwd);
			this.miDebugger.ssh(args.ssh, args.ssh.cwd, args.target, args.target_arguments, undefined, false, args.autorun || []).then(() => {
				this.sendResponse(response);
			}, err => {
				this.sendErrorResponse(response, 106, `Failed to SSH: ${err.toString()}`);
			});
		} else { // Local session
			this.miDebugger.load(args.cwd, args.target, args.target_arguments, undefined, args.autorun || []).then(() => {
				this.sendResponse(response);
			}, err => {
				this.sendErrorResponse(response, 107, `Failed to load MI Debugger: ${err.toString()}`);
			});
		}
	}

	protected override attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		const dbgCommand = args.aliceserver_path || "aliceserver";
		if (args.aliceserver_path === undefined && this.checkCommand(dbgCommand)) {
			this.sendErrorResponse(response, 104, `Configured debugger ${dbgCommand} not found.`);
			return;
		}

		this.miDebugger = new MI2_ALICE(dbgCommand, ["-a", "mi"], args.debugger_args, args.env);
		this.initDebugger();

		// Defaults
		this.quit = false;
		this.attached = true;
		this.initialRunCommand = args.stopAtConnect ? RunCommand.NONE : RunCommand.CONTINUE;
		this.isSSH = false;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.stopAtEntry = args.stopAtEntry;

		// Start session
		this.miDebugger.attach(args.cwd, args.executable, args.target, args.autorun || []).then(() => {
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 108, `Failed to attach: ${err.toString()}`);
		});
	}
}

DebugSession.run(AliceserverDebugSession);
