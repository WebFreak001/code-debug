import { MI2_LLDB } from "./mi2lldb";
import { Stack } from "../backend";
import { MINode } from "../mi_parse";

export class MI2_Mago extends MI2_LLDB {
	override getStack(startFrame: number, maxLevels: number, thread: number): Promise<Stack[]> {
		return new Promise((resolve, reject) => {
			const command = "stack-list-frames";
			this.sendCommand(command).then((result) => {
				const stack = result.resultRecords.results;
				const ret: Stack[] = [];
				const remaining: any = [];
				const addToStack = (element: any) => {
					const level = MINode.valueOf(element, "frame.level");
					const addr = MINode.valueOf(element, "frame.addr");
					const func = MINode.valueOf(element, "frame.func");
					const filename = MINode.valueOf(element, "file");
					const file = MINode.valueOf(element, "fullname");
					let line = 0;
					const lnstr = MINode.valueOf(element, "line");
					if (lnstr)
						line = parseInt(lnstr);
					const from = parseInt(MINode.valueOf(element, "from"));
					ret.push({
						address: addr,
						fileName: filename || "",
						file: file || "<unknown>",
						function: func || from || "<unknown>",
						level: level,
						line: line
					});
				};
				stack.forEach(element => {
					if (element)
						if (element[0] == "stack") {
							addToStack(element[1]);
						} else remaining.push(element);
				});
				if (remaining.length)
					addToStack(remaining);
				resolve(ret);
			}, reject);
		});
	}
}
