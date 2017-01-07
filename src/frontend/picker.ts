import * as vscode from "vscode";
import * as child_process from "child_process";
import * as os from "os";

interface IItem {
    name: string;
    id: string; //This is what gets returned eventually
}

class DockerItem implements IItem{
    name: string;
    id: string;
    protected image: string;
    protected labels: string;

    constructor(id, name, image, labels) {
        this.name = name + "["+id+"]";
        this.id = id;
        this.image = image
        this.labels = labels;
    }
    
    toAttachItem() {
        return {
            label: this.name,
            description: this.labels,
            detail: this.image,
            id: this.id
        };
    };
};

class ProcessItem implements IItem{
    name: string;
    id: string;
    protected commandLine: string;

    constructor(name, pid, commandLine) {
        this.name = name;
        this.id = pid;
        this.commandLine = commandLine;
    }

    toAttachItem() {
        return {
            label: this.name,
            description: this.id,
            detail: this.commandLine,
            id: this.id
        };
    };
};

abstract class Picker{
    launchConfig: any;

    getItems(){
        return this.getEntries().then(function (processEntries: any[]) {
            return processEntries.map(function (p) { return p.toAttachItem(); });
        });
    };

    pickItem(launchConfig){
        this.launchConfig = launchConfig;

        var attachPickOptions = {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: "Select the docker name to attach to"
        };
        return vscode.window.showQuickPick(this.getItems(), attachPickOptions)
            .then(function (dockerItem: any) {
                return dockerItem ? dockerItem.id : null;
            });
    };

    parseItems(items: string){
    //Parses a line of the output and returns array of objects
        var lines = items.split('\n');
        var entries = [];
        for (var i = 1; i < lines.length; i++) {
            var line = lines[i];
            if (!line) {
                continue;
            }
            var docker_1 = this.lineParser(line);
            entries.push(docker_1);
        }
        return entries;
    }

    execChildProcess(process, workingDirectory) {
        return new Promise(function (resolve, reject) {
            child_process.exec(process, { cwd: workingDirectory, maxBuffer: 512000 }, function (error, stdout, stderr) {
                if (error) {
                    reject(error);
                    return;
                }
                if (stderr && stderr.length > 0) {
                    reject(new Error(stderr));
                    return;
                }
                resolve(stdout);
            });
        });
    };

    abstract getEntries(): any; //any[]
    abstract lineParser(line: string): any;
}

export class DockerPicker extends Picker {
    getEntries() {
        var psCommand = ("docker ps --format {{.ID}}@{{.Names}}@{{.Image}}@{{.Labels}}");
        var _this = this
        return this.execChildProcess(psCommand, null).then(function (items: string) {
            return _this.parseItems('\n'+items); //Add bogus header line
        });
    }

    lineParser(line: string) {
        var dockerEntry = line.split('@');
        dockerEntry.push(dockerEntry.splice(3).join('@'));
        //Combine all entries after 4 in case labels can have @
        dockerEntry = dockerEntry.map(function(v){return v.trim();});
        return new DockerItem(dockerEntry[0], dockerEntry[1], dockerEntry[2], dockerEntry[3]);
    }
}

export class DockerPidPicker extends Picker {
    static secondColumnCharacters: number = 50;

    getEntries() {
        var _this = this;

        if (this.launchConfig.dockerName === "null"){return;}

        var dockerName = this.launchConfig.dockerName;

        var commColumnTitle = Array(DockerPidPicker.secondColumnCharacters).join("a");
        var psCommand = ("docker exec "+dockerName+" ps -axww -o pid=,comm=" + commColumnTitle + ",args=");
        return this.execChildProcess(psCommand, null).then(function (items: string) {
            return _this.parseItems(items);
        });
    }

    lineParser(line: string) {
        var psEntry = new RegExp("^\\s*([0-9]+)\\s+(.{" + (DockerPidPicker.secondColumnCharacters - 1) + "})\\s+(.*)$");
        var matches = psEntry.exec(line);
        if (matches && matches.length === 4) {
            var pid = matches[1].trim();
            var executable = matches[2].trim();
            var cmdline = matches[3].trim();
            return new ProcessItem(executable, pid, cmdline);
        }
    }
}

