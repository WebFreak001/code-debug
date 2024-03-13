import { MI2DebugSession, RunCommand } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2_LLDB } from "./backend/mi2/mi2lldb";
import { SSHArguments, ValuesFormattingMode } from './backend/backend';

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	cwd: string;
	target: string;
	lldbmipath: string;
	env: any;
	debugger_args: string[];
	pathSubstitutions: { [index: string]: string };
	arguments: string;
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
	lldbmipath: string;
	env: any;
	debugger_args: string[];
	pathSubstitutions: { [index: string]: string };
	executable: string;
	autorun: string[];
	stopAtConnect: boolean;
	stopAtEntry: boolean | string;
	valuesFormatting: ValuesFormattingMode;
	printCalls: boolean;
	showDevDebugOutput: boolean;
}

class LLDBDebugSession extends MI2DebugSession {
	protected override initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsGotoTargetsRequest = true;
		response.body.supportsHitConditionalBreakpoints = true;
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsFunctionBreakpoints = true;
		response.body.supportsEvaluateForHovers = true;
		this.sendResponse(response);
	}

	protected override launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		const dbgCommand = args.lldbmipath || "lldb-mi";
		if (this.checkCommand(dbgCommand)) {
			this.sendErrorResponse(response, 104, `Configured debugger ${dbgCommand} not found.`);
			return;
		}
		this.miDebugger = new MI2_LLDB(dbgCommand, [], args.debugger_args, args.env);
		this.setPathSubstitutions(args.pathSubstitutions);
		this.initDebugger();
		this.quit = false;
		this.attached = false;
		this.initialRunCommand = RunCommand.RUN;
		this.isSSH = false;
		this.started = false;
		this.crashed = false;
		this.setValuesFormattingMode(args.valuesFormatting);
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.stopAtEntry = args.stopAtEntry;
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
			this.setSourceFileMap(args.ssh.sourceFileMap, args.ssh.cwd, args.cwd);
			this.miDebugger.ssh(args.ssh, args.ssh.cwd, args.target, args.arguments, undefined, false, args.autorun || []).then(() => {
				this.sendResponse(response);
			}, err => {
				this.sendErrorResponse(response, 106, `Failed to SSH: ${err.toString()}`);
			});
		} else {
			this.miDebugger.load(args.cwd, args.target, args.arguments, undefined, args.autorun || []).then(() => {
				this.sendResponse(response);
			}, err => {
				this.sendErrorResponse(response, 107, `Failed to load MI Debugger: ${err.toString()}`);
			});
		}
	}

	protected override attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		const dbgCommand = args.lldbmipath || "lldb-mi";
		if (this.checkCommand(dbgCommand)) {
			this.sendErrorResponse(response, 104, `Configured debugger ${dbgCommand} not found.`);
			return;
		}
		this.miDebugger = new MI2_LLDB(dbgCommand, [], args.debugger_args, args.env);
		this.setPathSubstitutions(args.pathSubstitutions);
		this.initDebugger();
		this.quit = false;
		this.attached = true;
		this.initialRunCommand = args.stopAtConnect ? RunCommand.NONE : RunCommand.CONTINUE;
		this.isSSH = false;
		this.setValuesFormattingMode(args.valuesFormatting);
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.stopAtEntry = args.stopAtEntry;
		this.miDebugger.attach(args.cwd, args.executable, args.target, args.autorun || []).then(() => {
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 108, `Failed to attach: ${err.toString()}`);
		});
	}

	// Add extra commands for source file path substitution in LLDB-specific syntax
	protected setPathSubstitutions(substitutions: { [index: string]: string }): void {
		if (substitutions) {
			Object.keys(substitutions).forEach(source => {
				this.miDebugger.extraCommands.push("settings append target.source-map " + source + " " + substitutions[source]);
			});
		}
	}
}

DebugSession.run(LLDBDebugSession);
