import * as assert from 'assert';
import { parseMI, MINode } from '../../backend/mi_parse';

suite("MI Parse", () => {
	test("Very simple out of band record", () => {
		const parsed = parseMI(`*stopped`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, false);
		assert.strictEqual(parsed.outOfBandRecord[0].asyncClass, "stopped");
		assert.strictEqual(parsed.outOfBandRecord[0].output.length, 0);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Simple out of band record", () => {
		const parsed = parseMI(`4=thread-exited,id="3",group-id="i1"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, 4);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, false);
		assert.strictEqual(parsed.outOfBandRecord[0].asyncClass, "thread-exited");
		assert.strictEqual(parsed.outOfBandRecord[0].output.length, 2);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[0], ["id", "3"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[1], ["group-id", "i1"]);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Console stream output with new line", () => {
		const parsed = parseMI(`~"[Thread 0x7fffe993a700 (LWP 11002) exited]\\n"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, true);
		assert.strictEqual(parsed.outOfBandRecord[0].content, "[Thread 0x7fffe993a700 (LWP 11002) exited]\n");
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Unicode", () => {
		let parsed = parseMI(`~"[Depuraci\\303\\263n de hilo usando libthread_db enabled]\\n"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, true);
		assert.strictEqual(parsed.outOfBandRecord[0].content, "[Depuración de hilo usando libthread_db enabled]\n");
		assert.strictEqual(parsed.resultRecords, undefined);
		parsed = parseMI(`~"4\\t  std::cout << \\"\\345\\245\\275\\345\\245\\275\\345\\255\\246\\344\\271\\240\\357\\274\\214\\345\\244\\251\\345\\244\\251\\345\\220\\221\\344\\270\\212\\" << std::endl;\\n"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, true);
		assert.strictEqual(parsed.outOfBandRecord[0].content, `4\t  std::cout << "好好学习，天天向上" << std::endl;\n`);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Empty line", () => {
		const parsed = parseMI(``);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 0);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("'(gdb)' line", () => {
		const parsed = parseMI(`(gdb)`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 0);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Simple result record", () => {
		const parsed = parseMI(`1^running`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, 1);
		assert.strictEqual(parsed.outOfBandRecord.length, 0);
		assert.notStrictEqual(parsed.resultRecords, undefined);
		assert.strictEqual(parsed.resultRecords.resultClass, "running");
		assert.strictEqual(parsed.resultRecords.results.length, 0);
	});
	test("Advanced out of band record (Breakpoint hit)", () => {
		const parsed = parseMI(`*stopped,reason="breakpoint-hit",disp="keep",bkptno="1",frame={addr="0x00000000004e807f",func="D main",args=[{name="args",value="..."}],file="source/app.d",fullname="/path/to/source/app.d",line="157"},thread-id="1",stopped-threads="all",core="0"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, false);
		assert.strictEqual(parsed.outOfBandRecord[0].asyncClass, "stopped");
		assert.strictEqual(parsed.outOfBandRecord[0].output.length, 7);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[0], ["reason", "breakpoint-hit"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[1], ["disp", "keep"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[2], ["bkptno", "1"]);
		const frame = [
			["addr", "0x00000000004e807f"],
			["func", "D main"],
			["args", [[["name", "args"], ["value", "..."]]]],
			["file", "source/app.d"],
			["fullname", "/path/to/source/app.d"],
			["line", "157"]
		];
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[3], ["frame", frame]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[4], ["thread-id", "1"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[5], ["stopped-threads", "all"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[6], ["core", "0"]);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Advanced result record", () => {
		const parsed = parseMI(`2^done,asm_insns=[src_and_asm_line={line="134",file="source/app.d",fullname="/path/to/source/app.d",line_asm_insn=[{address="0x00000000004e7da4",func-name="_Dmain",offset="0",inst="push   %rbp"},{address="0x00000000004e7da5",func-name="_Dmain",offset="1",inst="mov    %rsp,%rbp"}]}]`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, 2);
		assert.strictEqual(parsed.outOfBandRecord.length, 0);
		assert.notStrictEqual(parsed.resultRecords, undefined);
		assert.strictEqual(parsed.resultRecords.resultClass, "done");
		assert.strictEqual(parsed.resultRecords.results.length, 1);
		const asmInsns = [
			"asm_insns",
			[
				[
					"src_and_asm_line",
					[
						["line", "134"],
						["file", "source/app.d"],
						["fullname", "/path/to/source/app.d"],
						[
							"line_asm_insn",
							[
								[
									["address", "0x00000000004e7da4"],
									["func-name", "_Dmain"],
									["offset", "0"],
									["inst", "push   %rbp"]
								],
								[
									["address", "0x00000000004e7da5"],
									["func-name", "_Dmain"],
									["offset", "1"],
									["inst", "mov    %rsp,%rbp"]
								]
							]
						]
					]
				]
			]
		];
		assert.deepStrictEqual(parsed.resultRecords.results[0], asmInsns);
		assert.strictEqual(parsed.result("asm_insns.src_and_asm_line.line_asm_insn[1].address"), "0x00000000004e7da5");
	});
	test("valueof children", () => {
		const obj = [
			[
				"frame",
				[
					["level", "0"],
					["addr", "0x0000000000435f70"],
					["func", "D main"],
					["file", "source/app.d"],
					["fullname", "/path/to/source/app.d"],
					["line", "5"]
				]
			],
			[
				"frame",
				[
					["level", "1"],
					["addr", "0x00000000004372d3"],
					["func", "rt.dmain2._d_run_main()"]
				]
			],
			[
				"frame",
				[
					["level", "2"],
					["addr", "0x0000000000437229"],
					["func", "rt.dmain2._d_run_main()"]
				]
			]
		];

		assert.strictEqual(MINode.valueOf(obj[0], "@frame.level"), "0");
		assert.strictEqual(MINode.valueOf(obj[0], "@frame.addr"), "0x0000000000435f70");
		assert.strictEqual(MINode.valueOf(obj[0], "@frame.func"), "D main");
		assert.strictEqual(MINode.valueOf(obj[0], "@frame.file"), "source/app.d");
		assert.strictEqual(MINode.valueOf(obj[0], "@frame.fullname"), "/path/to/source/app.d");
		assert.strictEqual(MINode.valueOf(obj[0], "@frame.line"), "5");

		assert.strictEqual(MINode.valueOf(obj[1], "@frame.level"), "1");
		assert.strictEqual(MINode.valueOf(obj[1], "@frame.addr"), "0x00000000004372d3");
		assert.strictEqual(MINode.valueOf(obj[1], "@frame.func"), "rt.dmain2._d_run_main()");
		assert.strictEqual(MINode.valueOf(obj[1], "@frame.file"), undefined);
		assert.strictEqual(MINode.valueOf(obj[1], "@frame.fullname"), undefined);
		assert.strictEqual(MINode.valueOf(obj[1], "@frame.line"), undefined);
	});
	test("empty string values", () => {
		const parsed = parseMI(`15^done,register-names=["r0","pc","","xpsr","","control"]`);
		const result = parsed.result('register-names');
		assert.deepStrictEqual(result, ["r0", "pc", "", "xpsr", "", "control"]);
	});
	test("empty string value first and last", () => {
		const parsed = parseMI(`15^done,register-names=["","r0","pc","","xpsr","","control",""]`);
		const result = parsed.result('register-names');
		assert.deepStrictEqual(result, ["", "r0", "pc", "", "xpsr", "", "control", ""]);
	});
	test("empty array values", () => {
		const parsed = parseMI(`15^done,foo={x=[],y="y"}`);
		assert.deepStrictEqual(parsed.result('foo.x'), []);
		assert.strictEqual(parsed.result('foo.y'), "y");
	});
	test("empty object values", () => {
		// GDB may send {} as empty array
		const parsed = parseMI(`15^done,foo={x={},y="y"}`);
		assert.deepStrictEqual(parsed.result('foo.x'), []);
		assert.strictEqual(parsed.result('foo.y'), "y");
	});
});
