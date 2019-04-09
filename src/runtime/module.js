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

var path = require('path');
var child_process = require('child_process');
var Promise = require('es6-promise').Promise;
var fs = require('fs');
var util = require('util');

module.exports = function(dev$) {
    return {
        spawn: function(moduleDirectory, args, options) {
            var scriptPath = path.resolve(process.cwd(), moduleDirectory, 'index.js');

            if(typeof options !== 'object') {
                options = { };
            }

            options.detached = false;
            options.stdio = [ 'ignore', 'pipe', 'pipe' ];

            return new Promise(function(resolve, reject) {
                var argv = [ scriptPath ];
                argv.push.apply(argv, args);
                var cp = child_process.fork(__dirname+'/run.js', argv, options);

                process.on('SIGINT', function() { cp.kill() });
                process.on('SIGTERM', function() { cp.kill() });
                process.on('exit', function() { cp.kill() });

                resolve(cp);
            });
        },
        load: function(moduleDirectory) {
            return new Promise(function(resolve, reject) {
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
                                    if(typeof error == 'object') error.filename = path; 
                                    reject(error);
                                }
                            }
                        });
                    });
                }

                function addModuleSchemas(moduleDirectory, dev$) {
                    var moduleInfoPath = path.resolve(process.cwd(), moduleDirectory, 'devicejs.json');

                    return new Promise(function(resolve, reject) {
                        try {
                            var devicejsModuleInfo = require(moduleInfoPath);
                            resolve(devicejsModuleInfo);
                        }
                        catch(error) {
                            reject(error);
                        }
                    }).then(function(devicejsModuleInfo) {
                        var interfaces = devicejsModuleInfo.devicejs.interfaces;
                        var resourceTypes = devicejsModuleInfo.devicejs.resourceTypes;
                        var promises = [ ];

                        if(Array.isArray(interfaces)) {
                            // load interface types into core
                            interfaces.forEach(function(interfaceFile) {
                                if(typeof interfaceFile === 'string') {
                                    promises.push(readJSONFile(path.resolve(process.cwd(), moduleDirectory, interfaceFile)).then(function(interfaceType) {
                                        return dev$.addInterfaceType(interfaceType);
                                    }));
                                }
                            });
                        }

                        if(Array.isArray(resourceTypes)) {
                            // load resource types into core
                            resourceTypes.forEach(function(resourceTypeFile) {
                                if(typeof resourceTypeFile === 'string') {
                                    promises.push(readJSONFile(path.resolve(process.cwd(), moduleDirectory, resourceTypeFile)).then(function(resourceType) {
                                        return dev$.addResourceType(resourceType);
                                    }));
                                }
                            });
                        }

                        return Promise.all(promises)
                    });
                }

                var modulePath = path.resolve(process.cwd(), moduleDirectory);

                try {
                    var stats = fs.statSync(modulePath);
                    if(stats.isDirectory()) {
                        addModuleSchemas(modulePath, dev$).then(function() {
                            try {
                                require(modulePath);
                                resolve();
                            } catch(e) {
                                if(e.stack) {
                                    console.error('Error in module "' + modulePath + '" --> ' + e.stack);
                                } else {
                                    console.error('Error in module "' + modulePath + '" --> ' + util.inspect(e));
                                }
                                reject(e);
                            }
                        }, function(error) {
                            console.error("Error in require:",error);
                            reject(error);
                        });
                    }
                    else {
                        require(modulePath);
                        resolve();
                    }
                }
                catch(e) {
                    if(e.stack) {
                        console.error('Error in module "' + modulePath + '" --> ' + e.stack);
                    } else {
                        console.error('Error in module "' + modulePath + '" --> ' + util.inspect(e));
                    }
                    reject(e);
                }
            });
        }
    };
};
