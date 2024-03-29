export interface MIInfo {
	token: number;
	outOfBandRecord: { isStream: boolean, type: string, asyncClass: string, output: [string, any][], content: string }[];
	resultRecords: { resultClass: string, results: [string, any][] };
}

const octalMatch = /^[0-7]{3}/;
function parseString(str: string): string {
	const ret = Buffer.alloc(str.length * 4);
	let bufIndex = 0;

	if (str[0] != '"' || str[str.length - 1] != '"')
		throw new Error("Not a valid string");
	str = str.slice(1, -1);
	let escaped = false;
	for (let i = 0; i < str.length; i++) {
		if (escaped) {
			let m;
			if (str[i] == '\\')
				bufIndex += ret.write('\\', bufIndex);
			else if (str[i] == '"')
				bufIndex += ret.write('"', bufIndex);
			else if (str[i] == '\'')
				bufIndex += ret.write('\'', bufIndex);
			else if (str[i] == 'n')
				bufIndex += ret.write('\n', bufIndex);
			else if (str[i] == 'r')
				bufIndex += ret.write('\r', bufIndex);
			else if (str[i] == 't')
				bufIndex += ret.write('\t', bufIndex);
			else if (str[i] == 'b')
				bufIndex += ret.write('\b', bufIndex);
			else if (str[i] == 'f')
				bufIndex += ret.write('\f', bufIndex);
			else if (str[i] == 'v')
				bufIndex += ret.write('\v', bufIndex);
			else if (str[i] == '0')
				bufIndex += ret.write('\0', bufIndex);
			else if (m = octalMatch.exec(str.substring(i))) {
				ret.writeUInt8(parseInt(m[0], 8), bufIndex++);
				i += 2;
			} else
				bufIndex += ret.write(str[i], bufIndex);
			escaped = false;
		} else {
			if (str[i] == '\\')
				escaped = true;
			else if (str[i] == '"')
				throw new Error("Not a valid string");
			else
				bufIndex += ret.write(str[i], bufIndex);
		}
	}
	return ret.slice(0, bufIndex).toString("utf8");
}

export class MINode implements MIInfo {
	token: number;
	outOfBandRecord: { isStream: boolean, type: string, asyncClass: string, output: [string, any][], content: string }[];
	resultRecords: { resultClass: string, results: [string, any][] };

	constructor(token: number, info: { isStream: boolean, type: string, asyncClass: string, output: [string, any][], content: string }[], result: { resultClass: string, results: [string, any][] }) {
		this.token = token;
		this.outOfBandRecord = info;
		this.resultRecords = result;
	}

	record(path: string): any {
		if (!this.outOfBandRecord)
			return undefined;
		return MINode.valueOf(this.outOfBandRecord[0].output, path);
	}

	result(path: string): any {
		if (!this.resultRecords)
			return undefined;
		return MINode.valueOf(this.resultRecords.results, path);
	}

	static valueOf(start: any, path: string): any {
		if (!start)
			return undefined;
		const pathRegex = /^\.?([a-zA-Z_\-][a-zA-Z0-9_\-]*)/;
		const indexRegex = /^\[(\d+)\](?:$|\.)/;
		path = path.trim();
		if (!path)
			return start;
		let current = start;
		do {
			let target = pathRegex.exec(path);
			if (target) {
				path = path.substring(target[0].length);
				if (current.length && typeof current != "string") {
					const found = [];
					for (const element of current) {
						if (element[0] == target[1]) {
							found.push(element[1]);
						}
					}
					if (found.length > 1) {
						current = found;
					} else if (found.length == 1) {
						current = found[0];
					} else return undefined;
				} else return undefined;
			} else if (path[0] == '@') {
				current = [current];
				path = path.substring(1);
			} else {
				target = indexRegex.exec(path);
				if (target) {
					path = path.substring(target[0].length);
					const i = parseInt(target[1]);
					if (current.length && typeof current != "string" && i >= 0 && i < current.length) {
						current = current[i];
					} else if (i == 0) {
						// empty
					} else return undefined;
				} else return undefined;
			}
			path = path.trim();
		} while (path);
		return current;
	}
}

const tokenRegex = /^\d+/;
const outOfBandRecordRegex = /^(?:(\d*|undefined)([\*\+\=])|([\~\@\&]))/;
const resultRecordRegex = /^(\d*)\^(done|running|connected|error|exit)/;
const newlineRegex = /^\r\n?/;
const endRegex = /^\(gdb\)\r\n?/;
const variableRegex = /^([a-zA-Z_\-][a-zA-Z0-9_\-]*)/;
const asyncClassRegex = /^[^,\r\n]+/;

export function parseMI(output: string): MINode {
	/*
		output ==>
			(
				exec-async-output     = [ token ] "*" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				status-async-output   = [ token ] "+" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				notify-async-output   = [ token ] "=" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				console-stream-output = "~" c-string \n
				target-stream-output  = "@" c-string \n
				log-stream-output     = "&" c-string \n
			)*
			[
				[ token ] "^" ("done" | "running" | "connected" | "error" | "exit") ( "," variable "=" (const | tuple | list) )* \n
			]
			"(gdb)" \n
	*/

	let token = undefined;
	const outOfBandRecord: { isStream: boolean, type: string, asyncClass: string, output: [string, any][], content: string }[] = [];
	let resultRecords = undefined;

	const asyncRecordType = {
		"*": "exec",
		"+": "status",
		"=": "notify"
	} as const;
	const streamRecordType = {
		"~": "console",
		"@": "target",
		"&": "log"
	} as const;

	const parseCString = () => {
		if (output[0] != '"')
			return "";
		let stringEnd = 1;
		let inString = true;
		let remaining = output.substring(1);
		let escaped = false;
		while (inString) {
			if (escaped)
				escaped = false;
			else if (remaining[0] == '\\')
				escaped = true;
			else if (remaining[0] == '"')
				inString = false;

			remaining = remaining.substring(1);
			stringEnd++;
		}
		let str;
		try {
			str = parseString(output.substring(0, stringEnd));
		} catch (e) {
			str = output.substring(0, stringEnd);
		}
		output = output.substring(stringEnd);
		return str;
	};

	let parseValue: () => any, parseCommaResult: () => any, parseCommaValue: () => any, parseResult: () => any;

	const parseTupleOrList = () => {
		if (output[0] != '{' && output[0] != '[')
			return undefined;
		const oldContent = output;
		const canBeValueList = output[0] == '[';
		output = output.substring(1);
		if (output[0] == '}' || output[0] == ']') {
			output = output.substring(1); // ] or }
			return [];
		}
		if (canBeValueList) {
			let value = parseValue();
			if (value !== undefined) { // is value list
				const values = [];
				values.push(value);
				const remaining = output;
				while ((value = parseCommaValue()) !== undefined)
					values.push(value);
				output = output.substring(1); // ]
				return values;
			}
		}
		let result = parseResult();
		if (result) {
			const results = [];
			results.push(result);
			while (result = parseCommaResult())
				results.push(result);
			output = output.substring(1); // }
			return results;
		}
		output = (canBeValueList ? '[' : '{') + output;
		return undefined;
	};

	parseValue = () => {
		if (output[0] == '"')
			return parseCString();
		else if (output[0] == '{' || output[0] == '[')
			return parseTupleOrList();
		else
			return undefined;
	};

	parseResult = () => {
		const variableMatch = variableRegex.exec(output);
		if (!variableMatch)
			return undefined;
		output = output.substring(variableMatch[0].length + 1);
		const variable = variableMatch[1];
		return [variable, parseValue()];
	};

	parseCommaValue = () => {
		if (output[0] != ',')
			return undefined;
		output = output.substring(1);
		return parseValue();
	};

	parseCommaResult = () => {
		if (output[0] != ',')
			return undefined;
		output = output.substring(1);
		return parseResult();
	};

	let match = undefined;

	while (match = outOfBandRecordRegex.exec(output)) {
		output = output.substring(match[0].length);
		if (match[1] && token === undefined && match[1] !== "undefined") {
			token = parseInt(match[1]);
		}

		if (match[2]) {
			const classMatch = asyncClassRegex.exec(output);
			output = output.substring(classMatch[0].length);
			const asyncRecord = {
				isStream: false,
				type: asyncRecordType[match[2] as keyof typeof asyncRecordType],
				asyncClass: classMatch[0],
				output: [] as any,
				content: ""
			};
			let result;
			while (result = parseCommaResult())
				asyncRecord.output.push(result);
			outOfBandRecord.push(asyncRecord);
		} else if (match[3]) {
			const streamRecord = {
				isStream: true,
				type: streamRecordType[match[3] as keyof typeof streamRecordType],
				content: parseCString(),
				output: [] as [string, any][],
				asyncClass: ""
			};
			outOfBandRecord.push(streamRecord);
		}

		output = output.replace(newlineRegex, "");
	}

	if (match = resultRecordRegex.exec(output)) {
		output = output.substring(match[0].length);
		if (match[1] && token === undefined) {
			token = parseInt(match[1]);
		}
		resultRecords = {
			resultClass: match[2],
			results: []
		};
		let result;
		while (result = parseCommaResult())
			resultRecords.results.push(result);

		output = output.replace(newlineRegex, "");
	}

	return new MINode(token, outOfBandRecord || [], resultRecords);
}
