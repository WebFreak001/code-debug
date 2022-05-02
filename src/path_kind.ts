import * as Path from "path";

export abstract class PathKind {
	protected abstract readonly path: typeof Path.posix | typeof Path.win32;
	public abstract readonly caseSensitive: boolean;

	// The path.posix.normalize routine will not convert Win32 path separators
	// to POSIX separators, so we explictily convert any Win32 path separators
	// to POSIX style separators.  The path.win32.normalize routine will accept
	// either Win32 or POSIX style separators and will normalize them to the
	// Win32 style.  Thus, if we convert all path separators to POSIX style and
	// then normalize, this will work for both systems.
	public normalize(p: string): string {
		return this.path.normalize(p.replace(/\\/g, "/"));
	}

	public normalizeDir(p: string): string {
		p = this.normalize(p);
		if (! p.endsWith(this.path.sep))
			p = this.path.join(p, this.path.sep);
		return p;
	}

	public join(...paths: string[]): string {
		return this.normalize(this.path.join(...paths));
	}

	public isAbsolute(p: string): boolean {
		return this.path.isAbsolute(this.normalize(p));
	}
}

export class PathWin32 extends PathKind {
	protected readonly path: typeof Path.posix | typeof Path.win32 = Path.win32;
	public readonly caseSensitive: boolean = false;
	private static instance: PathWin32;
	private constructor() { super(); }
	public static getInstance(): PathWin32 {
		if (! this.instance)
			this.instance = new PathWin32();
		return this.instance;
	}
}

export class PathPosix extends PathKind {
	protected readonly path: typeof Path.posix | typeof Path.win32 = Path.posix;
	public readonly caseSensitive: boolean = true;
	private static instance: PathPosix;
	private constructor() { super(); }
	public static getInstance(): PathPosix {
		if (! this.instance)
			this.instance = new PathPosix();
		return this.instance;
	}
}
