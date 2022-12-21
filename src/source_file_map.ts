import { PathKind, PathWin32, PathPosix } from "./path_kind";

interface Mapping {
	"remote": string;
	"local": string;
}

export class SourceFileMap {
	private sortedMappings: { [key in keyof Mapping]: Mapping[] } = {remote: [], local: []};
	private nativePath: PathKind;
	private remoteCwd: string|undefined;

	constructor (map: { [index: string]: string }, remoteCwd?: string) {
		const mappings: Mapping[] = [];
		this.remoteCwd = remoteCwd;
		this.nativePath = this.getNativePath();
		for (let [remotePrefix, localPrefix] of Object.entries(map)) {
			// Normalize local path, adding trailing separator if missing.
			localPrefix = this.nativePath.normalizeDir(localPrefix);

			// Try to detect remote path.
			const debuggerPath: PathKind = this.toPathKind(remotePrefix);
			// Normalize remote path, adding trailing separator if missing.
			remotePrefix = debuggerPath.normalizeDir(remotePrefix);

			mappings.push({remote: remotePrefix, local: localPrefix});
		}

		// Sort with longest paths first in case some paths are subsets, so that
		// we match the most appropriate (e.g., with path prefixes of '/home'
		// and '/home/foo', and a complete path of '/home/foo/bar.c', we should
		// match the '/home/foo' path prefix instead of '/home'.
		this.sortedMappings.local  = [...mappings].sort((a: Mapping, b: Mapping) => b.local.length - a.local.length);
		this.sortedMappings.remote = [...mappings].sort((a: Mapping, b: Mapping) => b.remote.length - a.remote.length);
	}

	// The native path selection is isolated here to allow for easy unit testing
	// allowing non-native path types to be tested by overriding this method in
	// a subclass in the test harness.
	protected getNativePath(): PathKind {
		if (process.platform == "win32")
			return PathWin32.getInstance();
		else
			return PathPosix.getInstance();
	}

	private toPathKind(unknownPath: string): PathKind {
		const pathPosix: PathKind = PathPosix.getInstance();
		const pathWin32: PathKind = PathWin32.getInstance();

		if (pathPosix.isAbsolute(unknownPath) ||
			(this.remoteCwd && pathPosix.isAbsolute(this.remoteCwd)))
		{
			return pathPosix;
		} else {
			return pathWin32;
		}
	}

	private pathMatch(key: keyof Mapping, caseSensitive: boolean, path: string): Mapping | undefined {
		for (const mapping of this.sortedMappings[key]) {
			let matched: boolean;

			if (caseSensitive)
				matched = path.startsWith(mapping[key]);
			else
				matched = path.toLowerCase().startsWith(mapping[key].toLowerCase());

			if (matched)
				return mapping;
		}

		return undefined;
	}

	public toLocalPath(remotePath: string): string {
		// Try to detect remote path.
		const debuggerPath: PathKind = this.toPathKind(remotePath);
		const normalizedRemotePath: string = debuggerPath.normalize(remotePath);
		const mapping: Mapping | undefined =
			this.pathMatch("remote", debuggerPath.caseSensitive, normalizedRemotePath);

		if (mapping) {
			const pathSuffix = normalizedRemotePath.substring(mapping.remote.length);
			return this.nativePath.join(mapping.local, pathSuffix);
		}

		// No mapping found, so return unmapped path.
		return remotePath;
	}

	public toRemotePath (localPath: string): string {
		const normalizedLocalPath = this.nativePath.normalize(localPath);
		const mapping: Mapping | undefined =
			this.pathMatch("local", this.nativePath.caseSensitive, normalizedLocalPath);

		if (mapping) {
			const pathSuffix = normalizedLocalPath.substring(mapping.local.length);
			// Try to detect remote path.
			const debuggerPath = this.toPathKind(mapping.remote);
			return debuggerPath.join(mapping.remote, pathSuffix);
		}

		// No mapping found, so return unmapped path.
		return localPath;
	}
}
