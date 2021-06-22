import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { RegisterTreeProvider } from './registers';

export function activate(context: vscode.ExtensionContext) {
	return new CodeDebugExtension(context);
}

export class CodeDebugExtension {
	private registerProvider: RegisterTreeProvider;

	constructor(private context: vscode.ExtensionContext) {
		this.registerProvider = new RegisterTreeProvider();

		context.subscriptions.push(
			vscode.workspace.registerTextDocumentContentProvider("debugmemory", new MemoryContentProvider()),
			vscode.commands.registerCommand("code-debug.examineMemoryLocation", examineMemory),
			vscode.commands.registerCommand("code-debug.getFileNameNoExt", () => {
				if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document || !vscode.window.activeTextEditor.document.fileName) {
					vscode.window.showErrorMessage("No editor with valid file name active");
					return;
				}
				const fileName = vscode.window.activeTextEditor.document.fileName;
				const ext = path.extname(fileName);
				return fileName.substr(0, fileName.length - ext.length);
			}),
			vscode.commands.registerCommand("code-debug.getFileBasenameNoExt", () => {
				if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document || !vscode.window.activeTextEditor.document.fileName) {
					vscode.window.showErrorMessage("No editor with valid file name active");
					return;
				}
				const fileName = path.basename(vscode.window.activeTextEditor.document.fileName);
				const ext = path.extname(fileName);
				return fileName.substr(0, fileName.length - ext.length);
			}),
			vscode.window.createTreeView('code-debug.registers', {
				treeDataProvider: this.registerProvider
			}),
			vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)),
			vscode.debug.onDidTerminateDebugSession(this.debugSessionTerminated.bind(this)),
			vscode.debug.onDidReceiveDebugSessionCustomEvent(this.debugSessionCustomEventReceived.bind(this)),
		);
	}

	private debugSessionStarted(e: vscode.DebugSession) {
		this.registerProvider.debugSessionStarted();
	}

	private debugSessionTerminated(e: vscode.DebugSession) {
		this.registerProvider.debugSessionTerminated();
	}

	private debugSessionCustomEventReceived(e: vscode.DebugSessionCustomEvent) {
		switch (e.event) {
			case 'custom-stopped':
				this.registerProvider.debugSessionStoped();
				break;

			case 'custom-continued':
				this.registerProvider.debugSessionContinued();
				break;

			default:
				break;
		}
	}
}

const memoryLocationRegex = /^0x[0-9a-f]+$/;

function getMemoryRange(range: string) {
	if (!range)
		return undefined;
	range = range.replace(/\s+/g, "").toLowerCase();
	let index;
	if ((index = range.indexOf("+")) != -1) {
		const from = range.substr(0, index);
		let length = range.substr(index + 1);
		if (!memoryLocationRegex.exec(from))
			return undefined;
		if (memoryLocationRegex.exec(length))
			length = parseInt(length.substr(2), 16).toString();
		return "from=" + encodeURIComponent(from) + "&length=" + encodeURIComponent(length);
	} else if ((index = range.indexOf("-")) != -1) {
		const from = range.substr(0, index);
		const to = range.substr(index + 1);
		if (!memoryLocationRegex.exec(from))
			return undefined;
		if (!memoryLocationRegex.exec(to))
			return undefined;
		return "from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
	} else if (memoryLocationRegex.exec(range))
		return "at=" + encodeURIComponent(range);
	else return undefined;
}

function examineMemory() {
	const socketlists = path.join(os.tmpdir(), "code-debug-sockets");
	if (!fs.existsSync(socketlists)) {
		if (process.platform == "win32")
			return vscode.window.showErrorMessage("This command is not available on windows");
		else
			return vscode.window.showErrorMessage("No debugging sessions available");
	}
	fs.readdir(socketlists, (err, files) => {
		if (err) {
			if (process.platform == "win32")
				return vscode.window.showErrorMessage("This command is not available on windows");
			else
				return vscode.window.showErrorMessage("No debugging sessions available");
		}
		const pickedFile = (file) => {
			vscode.window.showInputBox({ placeHolder: "Memory Location or Range", validateInput: range => getMemoryRange(range) === undefined ? "Range must either be in format 0xF00-0xF01, 0xF100+32 or 0xABC154" : "" }).then(range => {
				vscode.window.showTextDocument(vscode.Uri.parse("debugmemory://" + file + "?" + getMemoryRange(range)));
			});
		};
		if (files.length == 1)
			pickedFile(files[0]);
		else if (files.length > 0)
			vscode.window.showQuickPick(files, { placeHolder: "Running debugging instance" }).then(file => pickedFile(file));
		else if (process.platform == "win32")
			return vscode.window.showErrorMessage("This command is not available on windows");
		else
			vscode.window.showErrorMessage("No debugging sessions available");
	});
}

class MemoryContentProvider implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
		return new Promise((resolve, reject) => {
			const conn = net.connect(path.join(os.tmpdir(), "code-debug-sockets", uri.authority.toLowerCase()));
			let from, to;
			let highlightAt = -1;
			const splits = uri.query.split("&");
			if (splits[0].split("=")[0] == "at") {
				const loc = parseInt(splits[0].split("=")[1].substr(2), 16);
				highlightAt = 64;
				from = Math.max(loc - 64, 0);
				to = Math.max(loc + 768, 0);
			} else if (splits[0].split("=")[0] == "from") {
				from = parseInt(splits[0].split("=")[1].substr(2), 16);
				if (splits[1].split("=")[0] == "to") {
					to = parseInt(splits[1].split("=")[1].substr(2), 16);
				} else if (splits[1].split("=")[0] == "length") {
					to = from + parseInt(splits[1].split("=")[1]);
				} else return reject("Invalid Range");
			} else return reject("Invalid Range");
			if (to < from)
				return reject("Negative Range");
			conn.write("examineMemory " + JSON.stringify([from, to - from + 1]));
			conn.once("data", data => {
				let formattedCode = "                  00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F\n";
				var index: number = from;
				const hexString = data.toString();
				let x = 0;
				let asciiLine = "";
				let byteNo = 0;
				for (let i = 0; i < hexString.length; i += 2) {
					if (x == 0) {
						var addr = index.toString(16);
						while (addr.length < 16) addr = '0' + addr;
						formattedCode += addr + "  ";
					}
					index++;

					const digit = hexString.substr(i, 2);
					const digitNum = parseInt(digit, 16);
					if (digitNum >= 32 && digitNum <= 126)
						asciiLine += String.fromCharCode(digitNum);
					else
						asciiLine += ".";

					if (highlightAt == byteNo) {
						formattedCode = formattedCode.slice(0, -1) + "[" + digit + "]";
					} else {
						formattedCode += digit + " ";
					}

					if (x == 7)
						formattedCode += " ";

					if (++x >= 16) {
						formattedCode += " " + asciiLine + "\n";
						x = 0;
						asciiLine = "";
					}
					byteNo++;
				}
				if (x > 0) {
					for (let i = 0; i <= 16 - x; i++) {
						formattedCode += "   ";
					}
					if (x >= 8)
						formattedCode = formattedCode.slice(0, -2);
					else
						formattedCode = formattedCode.slice(0, -1);
					formattedCode += asciiLine;
				}
				resolve(center("Memory Range from 0x" + from.toString(16) + " to 0x" + to.toString(16), 84) + "\n\n" + formattedCode);
				conn.destroy();
			});
		});
	}
}

function center(str: string, width: number): string {
	var left = true;
	while (str.length < width) {
		if (left) str = ' ' + str;
		else str = str + ' ';
		left = !left;
	}
	return str;
}
