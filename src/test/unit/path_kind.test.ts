import * as assert from 'assert';
import { PathKind, PathWin32, PathPosix } from "../../path_kind";

suite("Path Kind", () => {
	const pathWin32: PathKind = PathWin32.getInstance();
	const pathPosix: PathKind = PathPosix.getInstance();
	test("Normalize", () => {
		assert.strictEqual(pathWin32.normalize("C:/foo/bar"), "C:\\foo\\bar");
		assert.strictEqual(pathWin32.normalize("C:\\foo\\bar"), "C:\\foo\\bar");
		assert.strictEqual(pathWin32.normalize("C:/foo/bar/"), "C:\\foo\\bar\\");
		assert.strictEqual(pathWin32.normalize("C:\\foo\\bar\\"), "C:\\foo\\bar\\");
		assert.strictEqual(pathWin32.normalize("C:\\foo\\bar\\.."), "C:\\foo");
		assert.strictEqual(pathWin32.normalize("C:\\foo\\bar\\..\\"), "C:\\foo\\");
		assert.strictEqual(pathWin32.normalize("C:\\foo\\..\\bar"), "C:\\bar");
		assert.strictEqual(pathWin32.normalize("C:\\foo\\..\\bar\\"), "C:\\bar\\");

		assert.strictEqual(pathPosix.normalize("\\home\\foo\\bar"), "/home/foo/bar");
		assert.strictEqual(pathPosix.normalize("/home/foo/bar"), "/home/foo/bar");
		assert.strictEqual(pathPosix.normalize("\\home\\foo\\bar\\"), "/home/foo/bar/");
		assert.strictEqual(pathPosix.normalize("/home/foo/bar/"), "/home/foo/bar/");
		assert.strictEqual(pathPosix.normalize("/home/foo/bar/.."), "/home/foo");
		assert.strictEqual(pathPosix.normalize("/home/foo/bar/../"), "/home/foo/");
		assert.strictEqual(pathPosix.normalize("/home/foo/../bar"), "/home/bar");
		assert.strictEqual(pathPosix.normalize("/home/foo/../bar/"), "/home/bar/");
	});
	test("Normalize Directory", () => {
		assert.strictEqual(pathWin32.normalizeDir("C:/foo/bar"), "C:\\foo\\bar\\");
		assert.strictEqual(pathWin32.normalizeDir("C:\\foo\\bar"), "C:\\foo\\bar\\");
		assert.strictEqual(pathWin32.normalizeDir("C:/foo/bar/"), "C:\\foo\\bar\\");
		assert.strictEqual(pathWin32.normalizeDir("C:\\foo\\bar\\"), "C:\\foo\\bar\\");
		assert.strictEqual(pathWin32.normalizeDir("C:\\foo\\bar\\.."), "C:\\foo\\");
		assert.strictEqual(pathWin32.normalizeDir("C:\\foo\\bar\\..\\"), "C:\\foo\\");
		assert.strictEqual(pathWin32.normalizeDir("C:\\foo\\..\\bar"), "C:\\bar\\");
		assert.strictEqual(pathWin32.normalizeDir("C:\\foo\\..\\bar\\"), "C:\\bar\\");

		assert.strictEqual(pathPosix.normalizeDir("\\home\\foo\\bar"), "/home/foo/bar/");
		assert.strictEqual(pathPosix.normalizeDir("/home/foo/bar"), "/home/foo/bar/");
		assert.strictEqual(pathPosix.normalizeDir("\\home\\foo\\bar\\"), "/home/foo/bar/");
		assert.strictEqual(pathPosix.normalizeDir("/home/foo/bar/"), "/home/foo/bar/");
		assert.strictEqual(pathPosix.normalizeDir("/home/foo/bar/.."), "/home/foo/");
		assert.strictEqual(pathPosix.normalizeDir("/home/foo/bar/../"), "/home/foo/");
		assert.strictEqual(pathPosix.normalizeDir("/home/foo/../bar"), "/home/bar/");
		assert.strictEqual(pathPosix.normalizeDir("/home/foo/../bar/"), "/home/bar/");
	});
	test("Join", () => {
		assert.strictEqual(pathWin32.join("C:/foo", "bar/baz.c"), "C:\\foo\\bar\\baz.c");
		assert.strictEqual(pathWin32.join("C:\\foo", "bar\\baz.c"), "C:\\foo\\bar\\baz.c");
		assert.strictEqual(pathWin32.join("C:\\foo\\", "\\bar\\baz.c"), "C:\\foo\\bar\\baz.c");
		assert.strictEqual(pathWin32.join("C:\\Foo\\", "\\Bar\\baz.c"), "C:\\Foo\\Bar\\baz.c");

		assert.strictEqual(pathPosix.join("\\home\\foo", "bar\\baz.c"), "/home/foo/bar/baz.c");
		assert.strictEqual(pathPosix.join("/home/foo", "bar/baz.c"), "/home/foo/bar/baz.c");
		assert.strictEqual(pathPosix.join("/home/foo/", "/bar/baz.c"), "/home/foo/bar/baz.c");
		assert.strictEqual(pathPosix.join("/home/Foo/", "/Bar/baz.c"), "/home/Foo/Bar/baz.c");
	});
	test("Is Absolute Path", () => {
		assert.strictEqual(pathWin32.isAbsolute("C:/foo/bar"), true);
		assert.strictEqual(pathWin32.isAbsolute("C:\\foo\\bar"), true);
		assert.strictEqual(pathWin32.isAbsolute("C:/foo/bar/"), true);
		assert.strictEqual(pathWin32.isAbsolute("C:\\foo\\bar\\"), true);
		assert.strictEqual(pathWin32.isAbsolute("C:\\foo\\..\\bar"), true);
		assert.strictEqual(pathWin32.isAbsolute("C:\\foo\\..\\bar\\"), true);
		assert.strictEqual(pathWin32.isAbsolute("foo/bar"), false);
		assert.strictEqual(pathWin32.isAbsolute("foo\\bar"), false);
		assert.strictEqual(pathWin32.isAbsolute("foo/bar/"), false);
		assert.strictEqual(pathWin32.isAbsolute("foo\\bar\\"), false);

		assert.strictEqual(pathPosix.isAbsolute("\\home\\foo\\bar"), true);
		assert.strictEqual(pathPosix.isAbsolute("/home/foo/bar"), true);
		assert.strictEqual(pathPosix.isAbsolute("\\home\\foo\\bar\\"), true);
		assert.strictEqual(pathPosix.isAbsolute("/home/foo/bar/"), true);
		assert.strictEqual(pathPosix.isAbsolute("/home/foo/../bar"), true);
		assert.strictEqual(pathPosix.isAbsolute("/home/foo/../bar/"), true);
		assert.strictEqual(pathPosix.isAbsolute("foo\\bar"), false);
		assert.strictEqual(pathPosix.isAbsolute("foo/bar"), false);
		assert.strictEqual(pathPosix.isAbsolute("foo\\bar\\"), false);
		assert.strictEqual(pathPosix.isAbsolute("foo/bar/"), false);
	});
});
