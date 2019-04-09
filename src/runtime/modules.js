/*
 * Copyright (c) 2018, Arm Limited and affiliates.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var argv = require('optimist').argv;
var defaults = require('./defaults.json');
var request = require('request');
var Promise = require('es6-promise').Promise;
var url = require('url');
var path = require('path');
var wrench = require('wrench');
var fs = require('fs');
var semver = require('semver');
var rimraf = require('rimraf');
var npm = require('npm');
var child_process = require('child_process');
var Table = require('easy-table');
var jsonminify = require('jsonminify');


if(typeof argv.config === 'string') {
    var configFile = argv.config;
}
else {
    var configFile = defaults.configFile;
}

try {
    var config = JSON.parse(jsonminify(fs.readFileSync(configFile, 'utf8')));
}
catch(error) {
    console.error('Could not load config file ' + configFile);
}


if(typeof config.modulesDirectory !== 'string') {
    console.error('Config file has no modulesDirectory specified');
    process.exit(1);
}

if(typeof config.stagingDirectory !== 'string') {
    var stagingDirectory = '/tmp/devicejs/staging';
}
else {
    var stagingDirectory = config.stagingDirectory;
}

if(typeof config.moduleRegistryURL !== 'string') {
    console.error('Config file has no moduleRegistryURL specified');
    process.exit(1);
}

var modulesURL = config.moduleRegistryURL;


var DEFAULT_SERVER_ADDRESS = '127.0.0.1';
var DEFAULT_SERVER_PORT = 8080;

if(argv.hasOwnProperty('serverAddress')) {
    var serverAddress = argv.serverAddress;
}
else {
    var serverAddress = DEFAULT_SERVER_ADDRESS;
}

if(argv.hasOwnProperty('serverPort')) {
    var serverPort = argv.serverPort;
}
else if(config && typeof config.serverPort === 'number') {
    var serverPort = config.serverPort;
}
else {
    var serverPort = DEFAULT_SERVER_PORT;
}

//var corePeer = new devicejs.DeviceJSPeer('http://' + serverAddress + ':' + serverPort);

var moduleInstallDirectory = config.modulesDirectory;

function enableModule(moduleName) {
    var moduleInstallPath = path.join(moduleInstallDirectory, 'installed', moduleName);
    var moduleEnabledPath = path.join(moduleInstallDirectory, 'enabled', moduleName);
    var moduleInfoPath = path.join(moduleInstallPath, 'devicejs.json');

    // create symlink in the enabled directory to point to the installed module
    return new Promise(function(resolve, reject) {
        fs.readFile(moduleInfoPath, 'utf8', function(error, data) {
            if(error) {
                reject(error);
            }
            else {
                try {
                    var moduleInfo = JSON.parse(data);

                    resolve(moduleInfo);
                }
                catch(error) {
                    reject(error);
                }
            }
        });
    }).then(function(moduleInfo) {
        return new Promise(function(resolve, reject) {
            fs.symlink(moduleInstallPath, moduleEnabledPath, function(error) {
                if(error) {
                    if(error.code === 'EEXIST') {
                        resolve(moduleInfo); 
                    }
                    else {
                        reject(error);                        
                    }
                }
                else {
                    resolve(moduleInfo);
                }
            });
        }.bind(this));
    }.bind(this)).then(function(moduleInfo) {
    }.bind(this), function(error) {
        console.error('Error enabling module ' + moduleName, error);                
        
        throw error;
    }); 
}

function disableModule(moduleName) {
    // removes from enabled directory
    var moduleEnabledDirectory = path.join(moduleInstallDirectory, 'enabled', moduleName);
    // create symlink in the enabled directory to point to the installed module

    return new Promise(function(resolve, reject) {
        fs.unlink(moduleEnabledDirectory, function(error) {
            if(error) {
                if(error.code === 'ENOENT') {
                    resolve();
                }
                else {
                    reject(error);
                }
            }
            else {
                resolve();
            }
        });
    }).then(function() {
    }, function(error) {
        if(error === 'No such module') {
        }
        else {
            throw error;
        }
    }.bind(this));
}

function readJSONFile(path) {
    return new Promise(function(resolve, reject) {
        fs.readFile(path, { encoding: 'utf8' }, function(error, data) {
            if(error) {
                reject(error);
            }
            else {
                try {
                    resolve(JSON.parse(data));
                }
                catch(error) {
                    reject(error);
                }
            }
        });
    });
}

function listModuleStatuses() {
    var moduleInstallPath = path.join(moduleInstallDirectory, 'installed');
    var moduleEnabledPath = path.join(moduleInstallDirectory, 'enabled');
    var moduleStatuses = { };
    var installedModuleNames;
    var enabledModuleNames;

    return new Promise(function(resolve, reject) {
        fs.readdir(moduleInstallPath, function(error, files) {
            if(error) {
                reject(error);
            }
            else {
                resolve(Promise.all(files.map(function(moduleName) {
                    return readJSONFile(path.join(moduleInstallPath, moduleName, 'devicejs.json')).then(function(moduleInfo) {
                        moduleStatuses[moduleName] = { version: moduleInfo.version, name: moduleName, enabled: false };
                    }, function(error) {
                    });
                })));
            }
        });
    }).then(function() {
        return new Promise(function(resolve, reject) {
            fs.readdir(moduleEnabledPath, function(error, files) {
                if(error) {
                    reject(error);
                }
                else {
                    files.forEach(function(moduleName) {
                        if(moduleStatuses[moduleName]) {
                            moduleStatuses[moduleName].enabled = true;
                        }
                    });

                    resolve(moduleStatuses);
                }
            });
        });
    });
}

var devicejsVersion = require('../../package.json').version;

wrench.mkdirSyncRecursive(stagingDirectory);

function sendRequest(method, path) {
    return new Promise(function(resolve, reject) {
        request({
            uri: url.resolve(modulesURL, path),
            method: method,
            json: true
        }, function(error, response, responseBody) {
            if(error) {
                reject(error);
            }
            else if(response.statusCode != 200) {
                reject({ status: response.statusCode, response: responseBody });
            }
            else {
                resolve(responseBody);
            }
        });
    });
}

function mkdir(directory) {
    return new Promise(function(resolve, reject) {
        fs.mkdir(directory, function(error) {
            if(error) {
                reject(error);
            }
            else {
                resolve();
            }
        });
    });
}

function rmrf(directory) {
    return new Promise(function(resolve, reject) {
        rimraf(directory, function(error) {
            if(error) {
                reject(error);
            }
            else {
                resolve();
            }
        });
    });
}

function mv(source, dest) {
    return new Promise(function(resolve, reject) {
        try {
            wrench.copyDirSyncRecursive(source, dest, {
                forceDelete: true
            });

            resolve(rmrf(source));
        }
        catch(e) {
            reject(e);
        }
    });
}

function exists(file) {
    return fs.existsSync(file);
}

function downloadModule(moduleName, version) {
    var parsedModulesURL = url.parse(modulesURL);
    var packageFileName = moduleName + '-' + version + '.tar.gz';
    var packageFilePath = path.join(parsedModulesURL.pathname, 'modules', moduleName, packageFileName);
    var packageURI = url.resolve(parsedModulesURL.href, packageFilePath);

    return new Promise(function(resolve, reject) {
        request.get(packageURI).on('response', function(res) {
            if(res.statusCode == 200) {
                var archiveWriteStream = fs.createWriteStream(path.join(stagingDirectory, moduleName + '.tar.gz'));

                res.pipe(archiveWriteStream);

                archiveWriteStream.on('finish', function() {
                    archiveWriteStream.close(function() {
                        //console.log('Downloaded package from', packageURI);
                        resolve();
                    });
                }).on('error', function(error) {
                    console.error('Unable to download package from', packageURI, error);
                    reject(error);
                });
            }
            else {
                console.log('Unable to download package from', packageURI, res.statusCode);
                reject(new Error('Could not retrieve file: ' + packageFileName));
            }
        }).on('error', function(error) {
            console.error('Unable to download package from', packageURI, error);
            reject(error);
        });
    });
}

function extractModule(moduleName) {
    var packageFileName = moduleName + '.tar.gz';
    var archiveFilePath = path.join(stagingDirectory, packageFileName);
    var extractedPath = path.join(stagingDirectory, moduleName);

    return rmrf(extractedPath).then(function() {
        return mkdir(extractedPath);
    }).then(function() {
        return new Promise(function(resolve, reject) {
            var extract = child_process.spawn('tar', [ '-xf', archiveFilePath, '-C', extractedPath ], { stdio: 'inherit' });

            extract.on('close', function(code) {
                if(code == 0) {
                    resolve();
                }
                else {
                    reject(new Error('Extract exited with code ' + code));
                }
            });
        }).then(function() {
            return rmrf(archiveFilePath);
        });
    }); 
}

function getActualVersion(moduleName, compatibleVersion) {
    return sendRequest('GET', '/modules/'+moduleName+'/version?compatibleVersions='+encodeURIComponent(compatibleVersion)).then(function(bestMatchVersion) {
        if(!semver.valid(bestMatchVersion.version)) {
            throw new Error('Invalid response from registry server');
        }

        return bestMatchVersion.version;
    }, function(error) {
        if(error.status && error.response) {
            console.error(error);
        }

        throw error;
    });
}

function moveStagingToInstalled() {
    return new Promise(function(resolve, reject) {
        // mv all directories from staging to install directory
        fs.readdir(stagingDirectory, function(error, files) {
            if(error) {
                reject(error);
            }
            else {
                resolve(Promise.all(files.map(function(moduleName) {
                    var extractedPath = path.join(stagingDirectory, moduleName, moduleName);
                    var installPath = path.join(moduleInstallDirectory, 'installed', moduleName);

                    return mv(extractedPath, installPath).then(function() {
                        rmrf(path.join(stagingDirectory, moduleName));
                    });
                })));
            }
        });
    });
}

function getModuleDependencies(moduleName) {
    try {
        var packageJSON = require(path.join(stagingDirectory, moduleName, moduleName, 'devicejs.json'));

        if(typeof packageJSON.devicejs === 'object' && typeof packageJSON.devicejs.dependencies === 'object') {
            return packageJSON.devicejs.dependencies;
        }
        else {
            return { };
        }
    }
    catch(error) {
        return { };
    }
}

function getDeviceJSCompatibleVersion(moduleName) {
    try {
        var packageJSON = require(path.join(stagingDirectory, moduleName, moduleName, 'devicejs.json'));

        if(typeof packageJSON.devicejs === 'object' 
            && typeof packageJSON.devicejs.engines === 'object'
            && typeof packageJSON.devicejs.engines.devicejs === 'string'
            && semver.validRange(packageJSON.devicejs.engines.devicejs)) {
            return packageJSON.devicejs.engines.devicejs;
        }
        else {
            return null;
        }
    }
    catch(error) {
        return null;
    }
}

function installNPMDependencies(devicejsJSONFile, modulesInstallDirectory) {
    var packageJSON = require(devicejsJSONFile);
    var npmDependencies = [ ];

    if(typeof packageJSON.dependencies === 'object') {
        Object.keys(packageJSON.dependencies).forEach(function(moduleName) {
            var version = packageJSON.dependencies[moduleName];

            if(version === '*') {
                npmDependencies.push(moduleName);
            }
            else if(semver.validRange(version)) {
                npmDependencies.push(moduleName+'@'+version);
            }
            else {
                npmDependencies.push(version);
            }
        });
    }

    return new Promise(function(resolve, reject) {
        npm.load(packageJSON, function(error) {
            if(error) {
                reject(error);
            }
            else {
                if(npmDependencies.length) {
                    npm.commands.install(modulesInstallDirectory, npmDependencies, function(error) {
                        if(error) {
                            reject(error);
                        }
                        else {
                            resolve();
                        }
                    });
                }
                else {
                    resolve();
                }
            }
        });
    });
}

function installModuleNPMDependencies(moduleName) {
    var modulesInstallDirectory = path.join(stagingDirectory, moduleName, moduleName);

    return installNPMDependencies(path.join(stagingDirectory, moduleName, moduleName, 'devicejs.json'), modulesInstallDirectory);
}

function getInstalledModuleVersion(moduleName) {
    var moduleInstallPath = path.join(moduleInstallDirectory, 'installed');

    try {
        var devicejsJSON = require(path.join(moduleInstallPath, moduleName, 'devicejs.json'));

        if(semver.valid(devicejsJSON.version)) {
            return devicejsJSON.version;
        }
        else {
            throw new Error('Installed module ' + moduleName + ' does not have a valid version');
        }
    }
    catch(error) {
        console.log(error.stack);
        throw new Error('Could not read the devicejs.json file of installed module ' + moduleName);
    }
}

function moduleIsInstalled(moduleName) {
    return exists(path.join(moduleInstallDirectory, 'installed', moduleName));
}

function versionsAreCompatible(installedVersion, compatibleVersion) {
    return semver.satisfies(installedVersion, compatibleVersion);
}

function installModule(moduleName, version, stagedModules) {
    console.log('Install', moduleName + '@' + version);

    return downloadModule(moduleName, version).then(function() {
        return extractModule(moduleName);
    }).then(function() {
        return installModuleNPMDependencies(moduleName);
    }).then(function() {
        var devicejsCompatibleVersion = getDeviceJSCompatibleVersion(moduleName);
        var dependencies = getModuleDependencies(moduleName, version);
        var promises = [ ];

        if(devicejsCompatibleVersion && !semver.satisfies(devicejsVersion, devicejsCompatibleVersion)) {
            throw new Error('Module incompatible with installed DeviceJS version: \n' +
                            '  Module Name:                    ' + moduleName + '\n' +
                            '  Compatible DeviceJS Version(s): ' + devicejsCompatibleVersion + '\n' +
                            '  Installed DeviceJS Version:     ' + devicejsVersion);
        }

        Object.keys(dependencies).forEach(function(moduleName) {
            var compatibleVersion = dependencies[moduleName];

            if(moduleIsInstalled(moduleName)) {
                // Is this module already installed? Is that installed version
                // compatible ?
                var installedVersion = getInstalledModuleVersion(moduleName);
                if(!versionsAreCompatible(installedVersion, compatibleVersion)) {
                    throw new Error('Required version of module is incompatible with installed version: \n' +
                                    '  Module Name:        ' + moduleName + '\n' +
                                    '  Installed Version:  ' + installedVersion + '\n' +
                                    '  Compatible Version: ' + compatibleVersion + '\n');
                }
            }
            else if(stagedModules[moduleName]) {
                // Did we already see this dependency? Is that dependency 
                // version that we are installing compatible?
                var stagedVersion = stagedModules[moduleName];

                if(!versionsAreCompatible(stagedVersion, compatibleVersion)) {
                    throw new Error('Dependencies on module with conflicting versions detected: \n' +
                                    '  Module Name: ' + moduleName + '\n' +
                                    '  Version 1:   ' + stagedVersion + '\n' +
                                    '  Version 2:   ' + compatibleVersion + '\n');
                }
            }
            else {
                promises.push(getActualVersion(moduleName, compatibleVersion).then(function(versionToInstall) { 
                    stagedModules[moduleName] = versionToInstall;
                    return { moduleName: moduleName, versionToInstall: versionToInstall }
                }));
            }
        });

        // Retrieve the version that will actually be installed so that 
        // dependencies lower in the tree will have knowledge of other dependencies
        // that are yet to be installed but are scheduled to be installed
        // so that they can see if the version is compatible
        return Promise.all(promises).then(function(values) {
            return Promise.all(values.map(function(moduleInfo) {
                return installModule(moduleInfo.moduleName, moduleInfo.versionToInstall, stagedModules);
            }));
        })
    }).then(function() {
        // Copy all staging install directories to install directory
    }).then(function() {
    }, function(error) {
        throw error;
    });

}

var command = argv._[0];
if(command == 'enable') {
    var moduleName = argv._[1];

    enableModule(moduleName).then(function() {
    }, function(error) {
        console.error('Error:', error);
    });
}
else if(command == 'disable') {
    var moduleName = argv._[1];

    disableModule(moduleName).then(function() {
    }, function(error) {
        console.error('Error:', error);
    });
}
/*else if(command == 'install') {
    var modulePath = argv._[1];
    var moduleName = require(path.join(modulePath, 'devicejs.json')).name;
    var moduleTargetDirectory = path.join(config.modulesDirectory, 'installed', moduleName);
    wrench.copyDirSyncRecursive(modulePath, moduleTargetDirectory, {
        forceDelete: false
    });
}*/
else if(command == 'install') {
    var moduleName = argv._[1];

    if(moduleName) {
        if(moduleName.indexOf('@') != -1) {
            var split = moduleName.split('@');

            moduleName = split[0];
            version = split[1];
        }
        else {
            version = '*';
        }

        if(version != '*' && !semver.valid(version)) {
            console.log('Invalid version number')
        }
        else {
            installModule(moduleName, version, { }).then(function() {
                return moveStagingToInstalled();
            }).then(function() {
                console.log('Done');
            }, function(error) {
                console.log('Error installing module: ', error.stack);
            });
        }
    }
    else {
        console.log('install', path.join(process.cwd(), 'devicejs.json'), process.cwd());
        installNPMDependencies(path.join(process.cwd(), 'devicejs.json'), process.cwd());
    }
}
else if(command == 'uninstall') {
    var moduleName = argv._[1];

    disableModule(moduleName).then(function() {
    }, function(error) {
    }).then(function() {
        var moduleDirectory = path.join(config.modulesDirectory, 'installed', moduleName);

        wrench.rmdirSyncRecursive(moduleDirectory, true);
    });
}
else if(command == 'publish') {
    var modulePath = argv._[1];
    var formData = {
        module: fs.createReadStream(modulePath),
    };

    request.post({ url: url.resolve(modulesURL, 'modules'), formData: formData }, function(error, httpResponse, body) {
        if(error) {
            console.log('An error occurred', error);
        }
        else {
            console.log(body);
        }
    });
}
else if(command == 'status') {
    var table = new Table();

    listModuleStatuses().then(function(moduleStatuses) {
        Object.keys(moduleStatuses).sort().forEach(function(moduleName) {
            var moduleVersion = moduleStatuses[moduleName].version;
            var enabled = moduleStatuses[moduleName].enabled;

            table.cell('Module Name', moduleName);
            table.cell('Module Version', moduleVersion);
            table.cell('Status', enabled?'enabled':'disabled');
            table.newRow();
        });

        console.log(table.toString());
    }, function(error) {
        console.error('Error: ', error);
    });
}
else {
    throw new Error('No such command');
}


// TODO: When installing a module, get the installed devicejs version
//       and detect whether or not it is compatible with the module.