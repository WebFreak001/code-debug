import * as assert from 'assert';
import { PathKind, PathWin32, PathPosix } from "../../path_kind";
import { SourceFileMap } from '../../source_file_map';

suite("Source File Map", () => {
	test("No Mappings", () => {
		const fileMap: SourceFileMap = new SourceFileMap({});
		const filePaths: string[] = [
			"C:\\foo\\src\\bar.c",
			"C:/foo/src/bar.c",
			"/home/foo/src/bar.c",
			"/home/Foo/src/bar.C"
		];

		filePaths.forEach(filePath => {
			assert.strictEqual(fileMap.toLocalPath(filePath), filePath);
			assert.strictEqual(fileMap.toRemotePath(filePath), filePath);
		});
	});
	test("Native Path is Local Path", () => {
		// Check native path before we override it in subsequent tests.
		class NativeSourceFileMap extends SourceFileMap {
			public getNativePathTest(): PathKind {
				return this.getNativePath();
			}
		}
		const fileMap: NativeSourceFileMap = new NativeSourceFileMap({});
		if (process.platform == "win32")
			assert.ok(fileMap.getNativePathTest() instanceof PathWin32);
		else
			assert.ok(fileMap.getNativePathTest() instanceof PathPosix);
	});
	suite("Local Paths are POSIX", () => {
		class PosixSourceFileMap extends SourceFileMap {
			protected getNativePath(): PathKind {
				return PathPosix.getInstance();
			}
		}
		test("Without Trailing Separator", () => {
			const fileMap: PosixSourceFileMap = new PosixSourceFileMap({"C:\\foo": "/home/foo"});
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\src\\bar.c"), "/home/foo/src/bar.c");
			assert.strictEqual(fileMap.toRemotePath("/home/foo/src/bar.c"), "C:\\foo\\src\\bar.c");
		});
		test("With Trailing Separator", () => {
			const fileMap: PosixSourceFileMap = new PosixSourceFileMap({"C:\\foo\\": "/home/foo/"});
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\src\\bar.c"), "/home/foo/src/bar.c");
			assert.strictEqual(fileMap.toRemotePath("/home/foo/src/bar.c"), "C:\\foo\\src\\bar.c");
		});
		test("Multiple Mappings", () => {
			const fileMap: PosixSourceFileMap = new PosixSourceFileMap({
				"C:\\fooA\\": "/home/foo1/",
				"C:\\fooB\\": "/home/foo2/",
				"C:\\fooC\\": "/home/foo3/",
			});
			assert.strictEqual(fileMap.toLocalPath("C:\\fooA\\src\\bar.c"), "/home/foo1/src/bar.c");
			assert.strictEqual(fileMap.toRemotePath("/home/foo1/src/bar.c"), "C:\\fooA\\src\\bar.c");
			assert.strictEqual(fileMap.toLocalPath("C:\\fooB\\src\\bar.c"), "/home/foo2/src/bar.c");
			assert.strictEqual(fileMap.toRemotePath("/home/foo2/src/bar.c"), "C:\\fooB\\src\\bar.c");
			assert.strictEqual(fileMap.toLocalPath("C:\\fooC\\src\\bar.c"), "/home/foo3/src/bar.c");
			assert.strictEqual(fileMap.toRemotePath("/home/foo3/src/bar.c"), "C:\\fooC\\src\\bar.c");
		});
		test("Case-Sensitive Paths", () => {
			const fileMap: PosixSourceFileMap = new PosixSourceFileMap({"C:\\foo\\": "/home/Foo/"});
			// Match
			assert.strictEqual(fileMap.toRemotePath("/home/Foo/Src/Bar.c"), "C:\\foo\\Src\\Bar.c");
			// No Match
			assert.strictEqual(fileMap.toRemotePath("/home/foo/Src/Bar.c"), "/home/foo/Src/Bar.c");
		});
		test("Case-Insensitive Paths", () => {
			const fileMap: PosixSourceFileMap = new PosixSourceFileMap({"C:\\foo\\": "/home/Foo/"});
			// Match
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\Src\\Bar.c"), "/home/Foo/Src/Bar.c");
			assert.strictEqual(fileMap.toLocalPath("c:\\Foo\\Src\\Bar.c"), "/home/Foo/Src/Bar.c");
		});
		test("Local and Remote Path Types the Same", () => {
			const fileMap: PosixSourceFileMap = new PosixSourceFileMap({"/home/foo": "/home/zoo"});
			// Match
			assert.strictEqual(fileMap.toLocalPath("/home/foo/bar.c"), "/home/zoo/bar.c");
			assert.strictEqual(fileMap.toRemotePath("/home/zoo/bar.c"), "/home/foo/bar.c");
			// No Match
			assert.strictEqual(fileMap.toLocalPath("/home/zoo/bar.c"), "/home/zoo/bar.c");
			assert.strictEqual(fileMap.toRemotePath("/home/foo/bar.c"), "/home/foo/bar.c");
		});
		test("Non-Normalized Paths", () => {
			const fileMap: PosixSourceFileMap = new PosixSourceFileMap({"C:/foo/bar/baz/..": "/home/foo/../bar"});
			assert.strictEqual(fileMap.toRemotePath("/home/foo/bar/baz.c"), "/home/foo/bar/baz.c");
			assert.strictEqual(fileMap.toRemotePath("/home/bar/baz.c"), "C:\\foo\\bar\\baz.c");
			assert.strictEqual(fileMap.toRemotePath("/home/foo/../bar/baz.c"), "C:\\foo\\bar\\baz.c");
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\bar\\baz\\zoo.c"), "/home/bar/baz/zoo.c");
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\bar\\baz\\..\\zoo.c"), "/home/bar/zoo.c");
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\bar\\baz.c"), "/home/bar/baz.c");
		});
		test("Overlapping Paths", () => {
			const fileMap: PosixSourceFileMap = new PosixSourceFileMap({
				"C:\\foo":      "/home/foo1",
				"C:\\foo\\bar": "/home/foo2",
				"C:\\zoo1":     "/home/zoo",
				"C:\\zoo2":     "/home/zoo/bar"
			});
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\baz.c"), "/home/foo1/baz.c");
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\bar\\baz.c"), "/home/foo2/baz.c");
			assert.strictEqual(fileMap.toRemotePath("/home/zoo/baz.c"), "C:\\zoo1\\baz.c");
			assert.strictEqual(fileMap.toRemotePath("/home/zoo/bar/baz.c"), "C:\\zoo2\\baz.c");
		});
	});
	suite("Local Paths are Win32", () => {
		class Win32SourceFileMap extends SourceFileMap {
			protected getNativePath(): PathKind {
				return PathWin32.getInstance();
			}
		}
		test("Without Trailing Separator", () => {
			const fileMap: Win32SourceFileMap = new Win32SourceFileMap({"/home/foo": "C:\\foo"});
			assert.strictEqual(fileMap.toLocalPath("/home/foo/src/bar.c"), "C:\\foo\\src\\bar.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\foo\\src\\bar.c"), "/home/foo/src/bar.c");
		});
		test("With Trailing Separator", () => {
			const fileMap: Win32SourceFileMap = new Win32SourceFileMap({"/home/foo/": "C:\\foo\\"});
			assert.strictEqual(fileMap.toLocalPath("/home/foo/src/bar.c"), "C:\\foo\\src\\bar.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\foo\\src\\bar.c"), "/home/foo/src/bar.c");
		});
		test("Multiple Mappings", () => {
			const fileMap: Win32SourceFileMap = new Win32SourceFileMap({
				"/home/foo1/": "C:\\fooA\\",
				"/home/foo2/": "C:\\fooB\\",
				"/home/foo3/": "C:\\fooC\\",
			});
			assert.strictEqual(fileMap.toLocalPath("/home/foo1/src/bar.c"), "C:\\fooA\\src\\bar.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\fooA\\src\\bar.c"), "/home/foo1/src/bar.c");
			assert.strictEqual(fileMap.toLocalPath("/home/foo2/src/bar.c"), "C:\\fooB\\src\\bar.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\fooB\\src\\bar.c"), "/home/foo2/src/bar.c");
			assert.strictEqual(fileMap.toLocalPath("/home/foo3/src/bar.c"), "C:\\fooC\\src\\bar.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\fooC\\src\\bar.c"), "/home/foo3/src/bar.c");
		});
		test("Case-Sensitive Paths", () => {
			const fileMap: Win32SourceFileMap = new Win32SourceFileMap({"/home/Foo/": "C:\\foo\\"});
			// Match
			assert.strictEqual(fileMap.toLocalPath("/home/Foo/Src/Bar.c"), "C:\\foo\\Src\\Bar.c");
			// No Match
			assert.strictEqual(fileMap.toLocalPath("/home/foo/Src/Bar.c"), "/home/foo/Src/Bar.c");
		});
		test("Case-Insensitive Paths", () => {
			const fileMap: Win32SourceFileMap = new Win32SourceFileMap({"/home/Foo/": "C:\\foo\\"});
			// Match
			assert.strictEqual(fileMap.toRemotePath("C:\\foo\\Src\\Bar.c"), "/home/Foo/Src/Bar.c");
			assert.strictEqual(fileMap.toRemotePath("c:\\Foo\\Src\\Bar.c"), "/home/Foo/Src/Bar.c");
		});
		test("Local and Remote Path Types the Same", () => {
			const fileMap: Win32SourceFileMap = new Win32SourceFileMap({"C:\\foo": "C:\\zoo"});
			// Match
			assert.strictEqual(fileMap.toLocalPath("C:\\foo\\bar.c"), "C:\\zoo\\bar.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\zoo\\bar.c"), "C:\\foo\\bar.c");
			// No Match
			assert.strictEqual(fileMap.toLocalPath("C:\\zoo\\bar.c"), "C:\\zoo\\bar.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\foo\\bar.c"), "C:\\foo\\bar.c");
		});
		test("Non-Normalized Paths", () => {
			const fileMap: Win32SourceFileMap = new Win32SourceFileMap({"/home/foo/../bar": "C:/foo/bar/baz/.."});
			assert.strictEqual(fileMap.toLocalPath("/home/foo/bar/baz.c"), "/home/foo/bar/baz.c");
			assert.strictEqual(fileMap.toLocalPath("/home/bar/baz.c"), "C:\\foo\\bar\\baz.c");
			assert.strictEqual(fileMap.toLocalPath("/home/foo/../bar/baz.c"), "C:\\foo\\bar\\baz.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\foo\\bar\\baz\\zoo.c"), "/home/bar/baz/zoo.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\foo\\bar\\baz\\..\\zoo.c"), "/home/bar/zoo.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\foo\\bar\\baz.c"), "/home/bar/baz.c");
		});
		test("Overlapping Paths", () => {
			const fileMap: Win32SourceFileMap = new Win32SourceFileMap({
				"/home/foo":     "C:\\foo1",
				"/home/foo/bar": "C:\\foo2",
				"/home/zoo1":    "C:\\zoo",
				"/home/zoo2":    "C:\\zoo\\bar"
			});
			assert.strictEqual(fileMap.toLocalPath("/home/foo/baz.c"), "C:\\foo1\\baz.c");
			assert.strictEqual(fileMap.toLocalPath("/home/foo/bar/baz.c"), "C:\\foo2\\baz.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\zoo\\baz.c"), "/home/zoo1/baz.c");
			assert.strictEqual(fileMap.toRemotePath("C:\\zoo\\bar\\baz.c"), "/home/zoo2/baz.c");
		});
	});
});
