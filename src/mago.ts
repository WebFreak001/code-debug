import { MI2DebugSession, RunCommand } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { MI2_Mago } from "./backend/mi2/mi2mago";
import { SSHArguments, ValuesFormattingMode } from './backend/backend';

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	cwd: string;
	target: string;
	magomipath: string;
	env: any;
	debugger_args: string[];
	arguments: string;
	autorun: string[];
	valuesFormatting: ValuesFormattingMode;
	printCalls: boolean;
	showDevDebugOutput: boolean;
}

export interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	cwd: string;
	target: string;
	magomipath: string;
	env: any;
	debugger_args: string[];
	executable: string;
	autorun: string[];
	stopAtConnect: boolean;
	valuesFormatting: ValuesFormattingMode;
	printCalls: boolean;
	showDevDebugOutput: boolean;
}

class MagoDebugSession extends MI2DebugSession {
	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
	}

	protected override initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsHitConditionalBreakpoints = true;
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsFunctionBreakpoints = true;
		response.body.supportsEvaluateForHovers = true;
		this.sendResponse(response);
	}

	getThreadID() {
		return 0;
	}

	protected override launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		const dbgCommand = args.magomipath || "mago-mi";
		if (this.checkCommand(dbgCommand)) {
			this.sendErrorResponse(response, 104, `Configured debugger ${dbgCommand} not found.`);
			return;
		}
		this.miDebugger = new MI2_Mago(dbgCommand, ["-q"], args.debugger_args, args.env);
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
		this.miDebugger.load(args.cwd, args.target, args.arguments, undefined, args.autorun || []).then(() => {
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 109, `Failed to load MI Debugger: ${err.toString()}`);
		});
	}

	protected override attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		const dbgCommand = args.magomipath || "mago-mi";
		if (this.checkCommand(dbgCommand)) {
			this.sendErrorResponse(response, 104, `Configured debugger ${dbgCommand} not found.`);
			return;
		}
		this.miDebugger = new MI2_Mago(dbgCommand, ["-q"], args.debugger_args, args.env);
		this.initDebugger();
		this.quit = false;
		this.attached = true;
		this.initialRunCommand = args.stopAtConnect ? RunCommand.NONE : RunCommand.CONTINUE;
		this.isSSH = false;
		this.setValuesFormattingMode(args.valuesFormatting);
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		this.miDebugger.attach(args.cwd, args.executable, args.target, args.autorun || []).then(() => {
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 110, `Failed to attach: ${err.toString()}`);
		});
	}
}

DebugSession.run(MagoDebugSession);
