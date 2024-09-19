import * as assert from 'assert';
import { expandValue, isExpandable } from '../../backend/gdb_expansion';
import { VariableObject } from '../../backend/backend';

suite("GDB Value Expansion", () => {
	const variableCreate = (variable: string) => ({ expanded: variable });
	test("Various values", () => {
		assert.strictEqual(isExpandable(`false`), 0);
		assert.strictEqual(expandValue(variableCreate, `false`), "false");
		assert.strictEqual(isExpandable(`5`), 0);
		assert.strictEqual(expandValue(variableCreate, `5`), "5");
		assert.strictEqual(isExpandable(`"hello world!"`), 0);
		assert.strictEqual(expandValue(variableCreate, `"hello world!"`), `"hello world!"`);
		assert.strictEqual(isExpandable(`0x7fffffffe956 "foobar"`), 0);
		assert.strictEqual(expandValue(variableCreate, `0x7fffffffe956 "foobar"`), `"foobar"`);
		assert.strictEqual(isExpandable(`0x0`), 0);
		assert.strictEqual(expandValue(variableCreate, `0x0`), "<nullptr>");
		assert.strictEqual(isExpandable(`0x000000`), 0);
		assert.strictEqual(expandValue(variableCreate, `0x000000`), "<nullptr>");
		assert.strictEqual(isExpandable(`{...}`), 2);
		assert.strictEqual(expandValue(variableCreate, `{...}`), "<...>");
		assert.strictEqual(isExpandable(`0x00abc`), 2);
		assert.strictEqual(expandValue(variableCreate, `0x007ffff7ecb480`), "*0x007ffff7ecb480");
		assert.strictEqual(isExpandable(`{a = b, c = d}`), 1);
		assert.deepStrictEqual(expandValue(variableCreate, `{a = b, c = d}`), [
			{
				name: "a",
				value: "b",
				variablesReference: 0
			}, {
				name: "c",
				value: "d",
				variablesReference: 0
			}]);
		assert.strictEqual(isExpandable(`{[0] = 0x400730 "foo", [1] = 0x400735 "bar"}`), 1);
		assert.deepStrictEqual(expandValue(variableCreate, `{[0] = 0x400730 "foo", [1] = 0x400735 "bar"}`), [
			{
				name: "[0]",
				value: "\"foo\"",
				variablesReference: 0
			}, {
				name: "[1]",
				value: "\"bar\"",
				variablesReference: 0
			}]);
		assert.strictEqual(isExpandable(`{{a = b}}`), 1);
		assert.deepStrictEqual(expandValue(variableCreate, `{{a = b}}`), [
			{
				name: "[0]",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "a",
							value: "b",
							variablesReference: 0
						}
					]
				}
			}
		]);
		assert.deepStrictEqual(expandValue(variableCreate, `{1, 2, 3, 4}`), [
			{
				name: "[0]",
				value: "1",
				variablesReference: 0
			}, {
				name: "[1]",
				value: "2",
				variablesReference: 0
			}, {
				name: "[2]",
				value: "3",
				variablesReference: 0
			}, {
				name: "[3]",
				value: "4",
				variablesReference: 0
			}]);
	});
	test("Error values", () => {
		assert.strictEqual(isExpandable(`<No data fields>`), 0);
		assert.strictEqual(expandValue(variableCreate, `<No data fields>`), "<No data fields>");
	});
	test("Nested values", () => {
		assert.strictEqual(isExpandable(`{a = {b = e}, c = d}`), 1);
		assert.deepStrictEqual(expandValue(variableCreate, `{a = {b = e}, c = d}`), [
			{
				name: "a",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "b",
							value: "e",
							variablesReference: 0
						}
					]
				}
			}, {
				name: "c",
				value: "d",
				variablesReference: 0
			}]);
	});
	test("Simple node", () => {
		assert.strictEqual(isExpandable(`{a = false, b = 5, c = 0x0, d = "foobar"}`), 1);
		const variables = expandValue(variableCreate, `{a = false, b = 5, c = 0x0, d = "foobar"}`);
		assert.strictEqual(variables.length, 4);
		assert.strictEqual(variables[0].name, "a");
		assert.strictEqual(variables[0].value, "false");
		assert.strictEqual(variables[1].name, "b");
		assert.strictEqual(variables[1].value, "5");
		assert.strictEqual(variables[2].name, "c");
		assert.strictEqual(variables[2].value, "<nullptr>");
		assert.strictEqual(variables[3].name, "d");
		assert.strictEqual(variables[3].value, `"foobar"`);
	});
	test("Complex node", () => {
		const node = `{quit = false, _views = {{view = 0x7ffff7ece1e8, renderer = 0x7ffff7eccc50, world = 0x7ffff7ece480}}, deltaTimer = {_flagStarted = false, _timeStart = {length = 0}, _timeMeasured = {length = 0}}, _start = {callbacks = 0x0}, _stop = {callbacks = 0x0}}`;
		assert.strictEqual(isExpandable(node), 1);
		const variables = expandValue(variableCreate, node);
		assert.deepStrictEqual(variables, [
			{
				name: "quit",
				value: "false",
				variablesReference: 0
			},
			{
				name: "_views",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "[0]",
							value: "Object",
							variablesReference: {
								expanded: [
									{
										name: "view",
										value: "Object@*0x7ffff7ece1e8",
										variablesReference: { expanded: "*_views[0].view" }
									},
									{
										name: "renderer",
										value: "Object@*0x7ffff7eccc50",
										variablesReference: { expanded: "*_views[0].renderer" }
									},
									{
										name: "world",
										value: "Object@*0x7ffff7ece480",
										variablesReference: { expanded: "*_views[0].world" }
									}
								]
							}
						}
					]
				}
			},
			{
				name: "deltaTimer",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "_flagStarted",
							value: "false",
							variablesReference: 0
						},
						{
							name: "_timeStart",
							value: "Object",
							variablesReference: {
								expanded: [
									{
										name: "length",
										value: "0",
										variablesReference: 0
									}
								]
							}
						},
						{
							name: "_timeMeasured",
							value: "Object",
							variablesReference: {
								expanded: [
									{
										name: "length",
										value: "0",
										variablesReference: 0
									}
								]
							}
						}
					]
				}
			},
			{
				name: "_start",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "callbacks",
							value: "<nullptr>",
							variablesReference: 0
						}
					]
				}
			},
			{
				name: "_stop",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "callbacks",
							value: "<nullptr>",
							variablesReference: 0
						}
					]
				}
			}
		]);
	});
	test("Simple node with errors", () => {
		const node = `{_enableMipMaps = false, _minFilter = <incomplete type>, _magFilter = <incomplete type>, _wrapX = <incomplete type>, _wrapY = <incomplete type>, _inMode = 6408, _mode = 6408, _id = 1, _width = 1024, _height = 1024}`;
		assert.strictEqual(isExpandable(node), 1);
		const variables = expandValue(variableCreate, node);
		assert.deepStrictEqual(variables, [
			{
				name: "_enableMipMaps",
				value: "false",
				variablesReference: 0
			},
			{
				name: "_minFilter",
				value: "<incomplete type>",
				variablesReference: 0
			},
			{
				name: "_magFilter",
				value: "<incomplete type>",
				variablesReference: 0
			},
			{
				name: "_wrapX",
				value: "<incomplete type>",
				variablesReference: 0
			},
			{
				name: "_wrapY",
				value: "<incomplete type>",
				variablesReference: 0
			},
			{
				name: "_inMode",
				value: "6408",
				variablesReference: 0
			},
			{
				name: "_mode",
				value: "6408",
				variablesReference: 0
			},
			{
				name: "_id",
				value: "1",
				variablesReference: 0
			},
			{
				name: "_width",
				value: "1024",
				variablesReference: 0
			},
			{
				name: "_height",
				value: "1024",
				variablesReference: 0
			}
		]);
	});
	test("lldb strings", () => {
		const node = `{ name = {...} }`;
		assert.strictEqual(isExpandable(node), 1);
		const variables = expandValue(variableCreate, node);
		assert.deepStrictEqual(variables, [
			{
				name: "name",
				value: "...",
				variablesReference: { expanded: "name" }
			}
		]);
	});
	test("float values", () => {
		const node = `{ intval1 = 123, floatval1 = 123.456, intval2 = 3, floatval2 = 234.45 }`;
		const variables = expandValue(variableCreate, node);

		assert.deepStrictEqual(variables, [
			{ name: "intval1", value: "123", variablesReference: 0 },
			{ name: "floatval1", value: "123.456", variablesReference: 0 },
			{ name: "intval2", value: "3", variablesReference: 0 },
			{ name: "floatval2", value: "234.45", variablesReference: 0 }
		]);
	});
	test("std container values", () => {
		let node = `std::vector of length 4, capacity 6 = {1, 2, 3, 4}`;
		let variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[3].value, `4`);
		node = `std::deque with 7 elements = {0, 1, 2, 3, 4, 5, 6}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[6].value, `6`);
		node = `std::__cxx11::list = {[0] = 6, [1] = 7, [2] = 8, [3] = 9, [4] = 10}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[4].value, `10`);
		node = `std::vector of length 4, capacity 6 = {std::vector of length 3, capacity 3 = {1, 2, 3}, std::vector of length 3, capacity 3 = {4, 5, 6}, std::vector of length 3, capacity 3 = {7, 8, 9}, std::vector of length 4, capacity 4 = {1, 2, 3, 4}}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[3].variablesReference.expanded[3].value, `4`);
		node = `std::deque with 3 elements = {std::deque with 2 elements = {10, 20}, std::deque with 2 elements = {30, 40}, std::deque with 7 elements = {0, 1, 2, 3, 4, 5, 6}}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[2].variablesReference.expanded[6].value, `6`);
		node = `std::__cxx11::list = {[0] = std::__cxx11::list = {[0] = 11, [1] = 12}, [1] = std::__cxx11::list = {[0] = 13, [1] = 14}, [2] = std::__cxx11::list = {[0] = 6, [1] = 7, [2] = 8, [3] = 9, [4] = 10}}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[2].variablesReference.expanded[4].value, `10`);
		node = `std::forward_list = {[0] = 0, [1] = 1, [2] = 2, [3] = 3}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[3].value, `3`);
		node = `std::set with 5 elements = {[0] = 1, [1] = 2, [2] = 3, [3] = 4, [4] = 5}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[4].value, `5`);
		node = `std::multiset with 6 elements = {[0] = 1, [1] = 2, [2] = 2, [3] = 2, [4] = 3, [5] = 4}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[5].value, `4`);
		node = `std::map with 3 elements = {[1] = \"one\", [2] = \"two\", [3] = \"three\"}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[2].value, `"three"`);
		node = `std::multimap with 3 elements = {[1] = \"one\", [2] = \"two\", [2] = \"another two\"}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[2].value, `"another two"`);
		node = `std::unordered_set with 5 elements = {[0] = 5, [1] = 2, [2] = 3, [3] = 1, [4] = 4}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[4].value, `4`);
		node = `std::unordered_multiset with 6 elements = {[0] = 1, [1] = 2, [2] = 2, [3] = 2, [4] = 3, [5] = 4}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[5].value, `4`);
		node = `std::unordered_map with 3 elements = {[3] = \"three\", [1] = \"one\", [2] = \"two\"}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[2].value, `"two"`);
		node = `std::unordered_multimap with 3 elements = {[2] = \"another two\", [2] = \"two\", [1] = \"one\"}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[2].value, `"one"`);
		node = `std::stack wrapping: std::deque with 2 elements = {1, 2}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[1].value, `2`);
		node = `std::queue wrapping: std::deque with 2 elements = {1, 2}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[1].value, `2`);
		node = `std::priority_queue wrapping: std::vector of length 3, capacity 4 = {4, 1, 3}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[2].value, `3`);
		node = `std::bitset = {[0] = 1, [2] = 1, [4] = 1, [6] = 1, [7] = 1}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[3].value, `1`);
		node = `{_M_elems = {1, 2, 3}}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[0].variablesReference.expanded[2].value, `3`);
		node = `std::unique_ptr<int> = {get() = 0x5555555d7d20}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[0].name, `get()`);
		assert.strictEqual(variables[0].value, `Object@*0x5555555d7d20`);
		node = `std::unique_ptr<int []> = {get() = 0x5555555d7d40}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[0].name, `get()`);
		assert.strictEqual(variables[0].value, `Object@*0x5555555d7d40`);
		node = `std::shared_ptr<int> (use count 1, weak count 1) = {get() = 0x5555555d7d70}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[0].name, `get()`);
		assert.strictEqual(variables[0].value, `Object@*0x5555555d7d70`);
		node = `{<std::__atomic_base<int>> = {static _S_alignment = 4, _M_i = 0}, <No data fields>}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[0].name, `std::__atomic_base<int>>`);
		assert.strictEqual(variables[0].variablesReference.expanded[1].name, `_M_i`);
		assert.strictEqual(variables[0].variablesReference.expanded[1].value, `0`);
		node = `{<std::__mutex_base> = {_M_mutex = {__data = {__lock = 0, __count = 0, __owner = 0, __nusers = 0, __kind = 0, __spins = 0, __elision = 0, __list = {__prev = 0x0, __next = 0x0}}, __size = '\\000' <repeats 39 times>, __align = 0}}, <No data fields>}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[0].variablesReference.expanded[0].variablesReference.expanded[0].variablesReference.expanded[7].variablesReference.expanded[1].name, `__next`);
		assert.strictEqual(variables[0].variablesReference.expanded[0].variablesReference.expanded[0].variablesReference.expanded[7].variablesReference.expanded[1].value, `<nullptr>`);
		node = `{static icase = <optimized out>, static nosubs = <optimized out>, static optimize = <optimized out>, static collate = <optimized out>, static ECMAScript = (unknown: 16), static basic = <optimized out>, static extended = <optimized out>, static awk = <optimized out>, static grep = <optimized out>, static egrep = <optimized out>, _M_flags = (unknown: 16), _M_loc = {static none = 0, static ctype = 1, static numeric = 2, static collate = 4, static time = 8, static monetary = 16, static messages = 32, static all = 63, _M_impl = 0x7ffff7fa8ce0, static _S_classic = <optimized out>, static _S_global = <optimized out>, static _S_categories = <optimized out>, static _S_once = <optimized out>, static _S_twinned_facets = <optimized out>}, _M_automaton = std::shared_ptr<const std::__detail::_NFA<std::__cxx11::regex_traits<char> >> (use count 1, weak count 0) = {get() = 0x5555555d81b0}}`;
		variables = expandValue(variableCreate, node);
		assert.strictEqual(variables[12].name, `_M_automaton`);
		assert.strictEqual(variables[12].variablesReference.expanded[0].value, `Object@*0x5555555d81b0`);

	});
});
