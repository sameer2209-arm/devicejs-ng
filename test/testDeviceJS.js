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
var expect = require('expect.js');
var should = require('should');
var shouldPromised = require('should-promised');
var DeviceDB = require('./devicedbServerTestFixture')
var devicedb = require('../src/runtime/devicedb');
var devicejs = require('../src/core/httpCore');
var Promise = require('es6-promise').Promise;
var http = require('http');
var wrench = require('wrench');
var rimraf = require('rimraf');
var path = require('path');
var fs = require('fs');
/*var memwatch = require('memwatch');

var hd = new memwatch.HeapDiff();

memwatch.on('leak', function(info) {
    console.log('LEAK FOUND', info);
    var diff = hd.end();
    hd = new memwatch.HeapDiff();

    console.log('Diff', JSON.stringify(diff, null, 4));
});*/

http.globalAgent.maxSockets = 1000;//Infinity; // Ensures we can send lots of http requests out at once
//http.globalAgent.keepAlive = true; // Ensures we can send lots of http requests out at once

var DEVICEDB_PORT = 9090;
var DEVICEJS_PORT = 10001;
var MODULE_INSTALL_DIRECTORY = '/tmp/testDeviceJSModuleInstallDirectory';

var ddbServer;
var coreServer;
var ddbCA = [
    fs.readFileSync(path.resolve(__dirname, '../deps/devicedb/src/devicedb/test_certs/ca.cert.pem')),
    fs.readFileSync(path.resolve(__dirname, '../deps/devicedb/src/devicedb/test_certs/intermediate.cert.pem'))
]

before(function() {
    ddbServer = new DeviceDB()

    coreServer = new devicejs.DeviceJSCore(DEVICEJS_PORT, { 
        nodeID: 'abc123',
        moduleInstallDirectory: MODULE_INSTALL_DIRECTORY,
        databaseConfig: {
            uri: 'https://127.0.0.1:'+DEVICEDB_PORT,
            https: {
                ca: ddbCA
            }
        },
        jwtSecret: 'myJWTSecretTemporary'
    });
});

after(function(done) {
    done();
});

function newDDBClient() {
    return devicedb({ uri: 'https://127.0.0.1:'+ DEVICEDB_PORT, https: { client: { ca: ddbCA } } });
}

function newDJSClient() {
    return new devicejs.DeviceJSPeer('http://127.0.0.1:' + DEVICEJS_PORT, {
        apiKey: 'abc123',
        apiSecret: 'myAPISecret'
    });
}

describe('Integration', function() {
    this.timeout(60000);

    describe('DeviceJSPeer', function() {
        beforeEach(function() {
            // Clear database
            //return ddbServer.start().then(function() {
            return ddbServer.stop().then(function() {
                return ddbServer.start()
            }).then(function() {
                return coreServer.start()
            }).then(function() {
            });
        });

        afterEach(function() {
            this.timeout(60000);
            //return ddbServer.stop().then(function() {
            //}, function(error) {
            //}).then(function() {
                return coreServer.stop().then(function() {
                }, function(error) {
                });
            //});
        });

        describe('#connect', function() {
            it('should emit connect event when connect succeeds', function() {
                var djsClient = newDJSClient();

                var connectEvent = new Promise(function(resolve, reject) {
                    djsClient.once('connect', function() {
                        resolve();
                    });
                });

                return Promise.all([
                    connectEvent.should.be.fulfilled(),
                    djsClient.connect().should.be.fulfilled()
                ]).should.be.fulfilled().then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should emit disconnect event when server is stopped', function() {
                var djsClient = newDJSClient(); 

                var disconnectEvent = new Promise(function(resolve, reject) {
                    djsClient.once('disconnect', function() {
                        resolve();
                    });
                });

                return djsClient.connect().then(function() {
                    return Promise.all([
                        disconnectEvent,
                        coreServer.stop()
                    ]);
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

        describe('#disconnect', function() {
            it('should emit disconnect event when disconnect fulfills', function() {
                var djsClient = newDJSClient(); 

                var disconnectEvent = new Promise(function(resolve, reject) {
                    djsClient.once('disconnect', function() {
                        resolve();
                    });
                });

                return djsClient.connect().then(function() {
                    return Promise.all([
                        disconnectEvent,
                        djsClient.disconnect()
                    ]);
                });
            });
        });

        describe('#addResourceType', function() {
            it('should succeed if schema is valid', function() {
                var djsClient = newDJSClient(); 
                var resourceSchema = {
                    name: 'MyResourceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',       // version is a semantic version string
                    interfaces: [ 'MyInterfaceType' ] // interfaces is a list of strings longer than 0 characters
                };

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({
                        'MyResourceType': {
                            '0.0.1': resourceSchema
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should overwrite a schema of the same version', function() {
                var djsClient = newDJSClient();
                var resourceSchema1 = {
                    name: 'MyResourceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',       // version is a semantic version string
                    interfaces: [ 'MyInterfaceType' ] // interfaces is a list of strings longer than 0 characters
                };

                var resourceSchema2 = {
                    name: 'MyResourceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',       // version is a semantic version string
                    interfaces: [ 'MyInterfaceType', 'MyInterfaceType1' ] // interfaces is a list of strings longer than 0 characters
                };

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema1);
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({
                        'MyResourceType': {
                            '0.0.1': resourceSchema1
                        }
                    });
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema2);
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({
                        'MyResourceType': {
                            '0.0.1': resourceSchema2
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should add both schemas of the same name and different versions', function() {
                var djsClient = newDJSClient();
                var resourceSchema1 = {
                    name: 'MyResourceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',       // version is a semantic version string
                    interfaces: [ 'MyInterfaceType' ] // interfaces is a list of strings longer than 0 characters
                };

                var resourceSchema2 = {
                    name: 'MyResourceType', // name is a string that is longer than 0 characters
                    version: '0.0.2',       // version is a semantic version string
                    interfaces: [ 'MyInterfaceType', 'MyInterfaceType1' ] // interfaces is a list of strings longer than 0 characters
                };

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema1);
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({
                        'MyResourceType': {
                            '0.0.1': resourceSchema1
                        }
                    });
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema2);
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({
                        'MyResourceType': {
                            '0.0.1': resourceSchema1,
                            '0.0.2': resourceSchema2
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if schema name is not a string', function() {
                var djsClient = newDJSClient(); 

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType({
                        name: 78,
                        version: '0.0.1',
                        interfaces: [ 'MyInterfaceType' ]
                    }).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if schema name is an empty string', function() {
                var djsClient = newDJSClient(); 

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType({
                        name: '',
                        version: '0.0.1',
                        interfaces: [ 'MyInterfaceType' ]
                    }).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if version is not a semantic version', function() {
                var djsClient = newDJSClient(); 

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType({
                        name: 'MyResourceType',
                        version: '0.0.',
                        interfaces: [ 'MyInterfaceType' ]
                    }).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if version is not a string', function() {
                var djsClient = newDJSClient(); 

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType({
                        name: 'MyResourceType',
                        version: 45,
                        interfaces: [ 'MyInterfaceType' ]
                    }).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if interface is not a string', function() {
                var djsClient = newDJSClient(); 

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType({
                        name: 'MyResourceType',
                        version: '0.0.1',
                        interfaces: [ 45 ]
                    }).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if interface is an empty string', function() {
                var djsClient = newDJSClient(); 

                return djsClient.connect().then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addResourceType({
                        name: 'MyResourceType',
                        version: '0.0.1',
                        interfaces: [ '' ]
                    }).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listResourceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

        describe('#addInterfaceType', function() {
            it('should succeed if schema is valid', function() {
                var djsClient = newDJSClient(); 
                var interfaceSchema = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        myCommand1: {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        myStateProperty1: {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        myEventType: {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({
                        'MyInterfaceType': {
                            '0.0.1': interfaceSchema
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            /*it('should succeed if schema properties contain dots', function() {
                var djsClient = newDJSClient(); 
                var interfaceSchema = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({
                        'MyInterfaceType': {
                            '0.0.1': interfaceSchema
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });*/

            it('should overwrite a schema of the same version', function() {
                var djsClient = newDJSClient();
                var interfaceSchema1 = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        myCommand1: {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        myStateProperty1: {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        myEventType: {
                            schema: { type: 'string' }
                        }
                    }
                };

                var interfaceSchema2 = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        myCommand1: {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        myStateProperty1: {
                            readOnly: false,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        },
                        myStateProperty2: {
                            readOnly: false,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        myEventType: {
                            schema: { type: 'string' }
                        }
                    }
                }

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema1);
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({
                        'MyInterfaceType': {
                            '0.0.1': interfaceSchema1
                        }
                    });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema2);
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({
                        'MyInterfaceType': {
                            '0.0.1': interfaceSchema2
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should add both schemas of the same name and different versions', function() {
                var djsClient = newDJSClient();

                var interfaceSchema1 = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        myCommand1: {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        myStateProperty1: {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        myEventType: {
                            schema: { type: 'string' }
                        }
                    }
                };

                var interfaceSchema2 = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: '0.0.2',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        myCommand1: {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        myStateProperty1: {
                            readOnly: false,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        },
                        myStateProperty2: {
                            readOnly: false,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        myEventType: {
                            schema: { type: 'string' }
                        }
                    }
                }

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema1);
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({
                        'MyInterfaceType': {
                            '0.0.1': interfaceSchema1
                        }
                    });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema2);
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({
                        'MyInterfaceType': {
                            '0.0.1': interfaceSchema1,
                            '0.0.2': interfaceSchema2
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if schema name is not a string', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 0, // name is a string that is longer than 0 characters
                    version: '0.0.1',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if schema name is an empty string', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: '', // name is a string that is longer than 0 characters
                    version: '0.0.1',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if version is not a semantic version', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: '0.0.',        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if version is not a string', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: 23,        // version is a semantic version string
                    commands: {              // commands is an object whose property names are non-empty strings
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
                            returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if commands is not an object', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType', // name is a string that is longer than 0 characters
                    version: '0.0.1',        // version is a semantic version string
                    commands: null,
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,   // readOnly is a boolean value
                            schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if command argument is an not an object', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType',
                    version: '0.0.1',
                    commands: {
                        'myCommand1.hello.asdf:': {        
                            arguments: [ 32 ],
                            returns: { type: 'number' }
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,
                            schema: { type: 'number' }
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if return value is not an object', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType',
                    version: '0.0.1',
                    commands: {
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],
                            returns: null
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,
                            schema: { type: 'number' }
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if readOnly is not a boolean', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType',
                    version: '0.0.1',
                    commands: {
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],
                            returns: { type: 'string' }
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: null,
                            schema: { type: 'number' }
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if state schema is not an object', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType',
                    version: '0.0.1',
                    commands: {
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],
                            returns: { type: 'string' }
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,
                            schema: null
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { type: 'string' }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if event schema is not an object', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType',
                    version: '0.0.1',
                    commands: {
                        'myCommand1.hello.asdf:': {        
                            arguments: [ { type: 'string' } ],
                            returns: { type: 'string' }
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,
                            schema: { type: 'string' }
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: null
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if command name is an empty string', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType',
                    version: '0.0.1',
                    commands: {
                        '': {
                            arguments: [ { type: 'string' } ],
                            returns: { type: 'string' }
                        }
                    },
                    state: {
                        'ok.myStateProperty1': {
                            readOnly: true,
                            schema: { type: 'string' }
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if state property is an empty string', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType',
                    version: '0.0.1',
                    commands: {
                        'asdf': {        
                            arguments: [ { type: 'string' } ],
                            returns: { type: 'string' }
                        }
                    },
                    state: {
                        '': {
                            readOnly: true,
                            schema: { type: 'string' }
                        }
                    },
                    events: {
                        'masdf.saddsf': {
                            schema: { }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if event name is an empty string', function() {
                var djsClient = newDJSClient(); 

                var interfaceSchema = {
                    name: 'MyInterfaceType',
                    version: '0.0.1',
                    commands: {
                        'asdf': {        
                            arguments: [ { type: 'string' } ],
                            returns: { type: 'string' }
                        }
                    },
                    state: {
                        'dasdf': {
                            readOnly: true,
                            schema: { type: 'string' }
                        }
                    },
                    events: {
                        '': {
                            schema: { }
                        }
                    }
                };

                return djsClient.connect().then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema).should.be.rejectedWith({
                        status: 400,
                        response: /Validation Error/
                    });
                }).then(function() {
                    return djsClient.listInterfaceTypes().should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

        describe('#registerResource', function() {
            var interfaceSchema = {
                name: 'MyInterfaceType',
                version: '0.0.1',
                commands: {
                    myCommand: {        
                        arguments: [ { type: 'string' } ],
                        returns: { type: 'number' }
                    }
                },
                state: {
                    myStateProperty: {
                        readOnly: true,
                        schema: { type: 'number' }
                    }
                },
                events: {
                    myEventType: {
                        schema: { type: 'string' }
                    }
                }
            };

            var resourceSchema = {
                name: 'MyResourceType',
                version: '0.0.1',
                interfaces: [ 'MyInterfaceType' ]
            };

            it('should succeed if resource ID is non-empty, resource type is known, and resource ID is not yet registered', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: true,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should cause a register event to be fired if registration is successful', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    var idSelection = djsClient.selectByID('myResource1');
                    var typeSelection = djsClient.selectByType('MyResourceType');
                    var interfaceSelection = djsClient.selectByInterface('MyInterfaceType');

                    var eventsOccur = Promise.all([
                        new Promise(function(resolve, reject) {
                            idSelection.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('register');
                                eventData.should.be.eql({ definition: resourceSchema });
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            typeSelection.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('register');
                                eventData.should.be.eql({ definition: resourceSchema });
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            interfaceSelection.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('register');
                                eventData.should.be.eql({ definition: resourceSchema });
                                resolve();
                            });
                        })
                    ]);
                    
                    return idSelection.subscribeToEvent('register').then(function() {
                        return typeSelection.subscribeToEvent('register');
                    }).then(function() {
                        return interfaceSelection.subscribeToEvent('register');
                    }).then(function() {
                        return Promise.all([
                            eventsOccur,
                            djsClient.registerResource('myResource1', 'MyResourceType')
                        ]);
                    });
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: true,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should receive control messages for this resource if registration is successful', function() {
                this.timeout(60000);
                var djsClient = newDJSClient();
                var djsClientController = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClientController.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    var willReceiveControlMessages = {};
                    var commandReceiveMap = { 'first': false, 'second': false, 'third': false };
                    var setReceiveMap = { 22: false, 34: false, 69: false };
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByID('myResource1').call('myCommand', 'first');
                    djsClientController.selectByInterface('MyInterfaceType').call('myCommand', 'second');
                    djsClientController.selectByType('MyResourceType').call('myCommand', 'third');

                    djsClientController.selectByID('myResource1').set('myStateProperty', 22);
                    djsClientController.selectByInterface('MyInterfaceType').set('myStateProperty', 34);
                    djsClientController.selectByType('MyResourceType').set('myStateProperty', 69);

                    djsClientController.selectByID('myResource1').get('myStateProperty');
                    djsClientController.selectByInterface('MyInterfaceType').get('myStateProperty');
                    djsClientController.selectByType('MyResourceType').get('myStateProperty');

                    return Promise.all([
                        new Promise(function(resolve, reject) {
                            djsClient.on('command', function(commandName, args) {
                                //console.log('COMMAND');
                                commandName.should.be.eql('myCommand');
                                args.should.be.Array();
                                commandReceiveMap.should.have.ownProperty(args[0]);
                                commandReceiveMap[args[0]] = true;

                                commandsReceived += 1;

                                if(commandsReceived == Object.keys(commandReceiveMap).length) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state get', function(property) {
                                //console.log('STATE GET');
                                property.should.be.eql('myStateProperty');

                                getsReceived += 1;

                                if(getsReceived == 3) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state set', function(property, value) {
                                //console.log('STATE SET');
                                property.should.be.eql('myStateProperty');
                                setReceiveMap.should.have.ownProperty(value);
                                setReceiveMap[value] = true;

                                setsReceived += 1;

                                if(setsReceived == Object.keys(setReceiveMap).length) {
                                    resolve();
                                }
                            });
                        })
                    ]).then(function() {
                        commandReceiveMap.should.be.eql({ 'first': true, 'second': true, 'third': true });
                        setReceiveMap.should.be.eql({ 22: true, 34: true, 69: true });
                    });
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientController.disconnect();
                });
            });

            it('should fail if resource ID is empty string', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('', 'MyResourceType').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource ID'
                    });
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if resource ID is already registered', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType').should.be.rejectedWith({ 
                        status: 500,
                        response: 'Already registered'
                    });
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: true,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if resource type is unknown', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType2').should.be.rejectedWith({ 
                        status: 400,
                        response: 'Invalid resource type'
                    });
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

        describe('#unregisterResource', function() {
            var interfaceSchema = {
                name: 'MyInterfaceType',
                version: '0.0.1',
                commands: {
                    myCommand: {        
                        arguments: [ { type: 'string' } ],
                        returns: { type: 'number' }
                    }
                },
                state: {
                    myStateProperty: {
                        readOnly: true,
                        schema: { type: 'number' }
                    }
                },
                events: {
                    myEventType: {
                        schema: { type: 'string' }
                    }
                }
            };

            var resourceSchema = {
                name: 'MyResourceType',
                version: '0.0.1',
                interfaces: [ 'MyInterfaceType' ]
            };

            it('should succeed if resource ID is non-empty string and registered to the requesting peer', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: true,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.unregisterResource('myResource1');
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: false,
                            registered: false,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
            
            it('should succeed if resource ID is non-empty string and registered to the requesting peer (2)', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: true,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.publishResourceEvent('myResource1', 'unreachable')
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: false,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.publishResourceEvent('myResource1', 'reachable')
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: true,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.unregisterResource('myResource1');
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: false,
                            registered: false,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should cause an unregister event to be fired if registration is successful', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    var idSelection = djsClient.selectByID('myResource1');
                    var typeSelection = djsClient.selectByType('MyResourceType');
                    var interfaceSelection = djsClient.selectByInterface('MyInterfaceType');

                    var eventsOccur = Promise.all([
                        new Promise(function(resolve, reject) {
                            idSelection.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('unregister');
                                eventData.should.be.eql({ definition: resourceSchema });
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            typeSelection.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('unregister');
                                eventData.should.be.eql({ definition: resourceSchema });
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            interfaceSelection.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('unregister');
                                eventData.should.be.eql({ definition: resourceSchema });
                                resolve();
                            });
                        })
                    ]);
                    
                    return idSelection.subscribeToEvent('unregister').then(function() {
                        return typeSelection.subscribeToEvent('unregister');
                    }).then(function() {
                        return interfaceSelection.subscribeToEvent('unregister');
                    }).then(function() {
                        return Promise.all([
                            eventsOccur,
                            djsClient.unregisterResource('myResource1')
                        ]);
                    });
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: false,
                            registered: false,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should stop receiving control messages for this resource if unregistration is successful', function() {
                var djsClient = newDJSClient();
                var djsClientController = newDJSClient();
                this.timeout(60000);

                return djsClient.connect().then(function() {
                    return djsClientController.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    var willReceiveControlMessages = {};
                    var commandReceiveMap = { 'first': false, 'second': false, 'third': false };
                    var setReceiveMap = { 22: false, 34: false, 69: false };
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByID('myResource1').call('myCommand', 'first');
                    djsClientController.selectByInterface('MyInterfaceType').call('myCommand', 'second');
                    djsClientController.selectByType('MyResourceType').call('myCommand', 'third');

                    djsClientController.selectByID('myResource1').set('myStateProperty', 22);
                    djsClientController.selectByInterface('MyInterfaceType').set('myStateProperty', 34);
                    djsClientController.selectByType('MyResourceType').set('myStateProperty', 69);

                    djsClientController.selectByID('myResource1').get('myStateProperty');
                    djsClientController.selectByInterface('MyInterfaceType').get('myStateProperty');
                    djsClientController.selectByType('MyResourceType').get('myStateProperty');

                    return Promise.all([
                        new Promise(function(resolve, reject) {
                            djsClient.on('command', function(commandName, args) {
                                commandName.should.be.eql('myCommand');
                                args.should.be.Array();
                                commandReceiveMap.should.have.ownProperty(args[0]);
                                commandReceiveMap[args[0]] = true;

                                commandsReceived += 1;

                                if(commandsReceived == Object.keys(commandReceiveMap).length) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state get', function(property) {
                                property.should.be.eql('myStateProperty');

                                getsReceived += 1;

                                if(getsReceived == 3) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state set', function(property, value) {
                                property.should.be.eql('myStateProperty');
                                setReceiveMap.should.have.ownProperty(value);
                                setReceiveMap[value] = true;

                                setsReceived += 1;

                                if(setsReceived == Object.keys(setReceiveMap).length) {
                                    resolve();
                                }
                            });
                        })
                    ]).then(function() {
                        commandReceiveMap.should.be.eql({ 'first': true, 'second': true, 'third': true });
                        setReceiveMap.should.be.eql({ 22: true, 34: true, 69: true });
                    });
                }).then(function() {
                    return djsClient.unregisterResource('myResource1');
                }).then(function() {
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByID('myResource1').call('myCommand', 'first');
                    djsClientController.selectByInterface('MyInterfaceType').call('myCommand', 'second');
                    djsClientController.selectByType('MyResourceType').call('myCommand', 'third');

                    djsClientController.selectByID('myResource1').set('myStateProperty', 22);
                    djsClientController.selectByInterface('MyInterfaceType').set('myStateProperty', 34);
                    djsClientController.selectByType('MyResourceType').set('myStateProperty', 69);

                    djsClientController.selectByID('myResource1').get('myStateProperty');
                    djsClientController.selectByInterface('MyInterfaceType').get('myStateProperty');
                    djsClientController.selectByType('MyResourceType').get('myStateProperty');

                    djsClient.on('command', function(commandName, args) {
                        commandsReceived += 1;
                    });
                    djsClient.on('state get', function(property) {
                        getsReceived += 1;
                    });
                    djsClient.on('state set', function(property, value) {
                        setsReceived += 1;
                    });

                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            commandsReceived.should.be.eql(0);
                            getsReceived.should.be.eql(0);
                            setsReceived.should.be.eql(0);
                            resolve();
                        }, 5000);
                    });
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientController.disconnect();
                });
            });

            it('should fail if resource is not registered to the requesting peer', function() {
                var djsClient = newDJSClient();
                var djsClientOther = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClientOther.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: true,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClientOther.unregisterResource('myResource1').should.be.rejectedWith({
                        status: 403,
                        response: 'Peer does not own this resource'
                    });
                }).then(function() {
                    return djsClient.listResources('type="MyResourceType"').should.be.fulfilledWith({ 
                        myResource1: {
                            reachable: true,
                            registered: true,
                            type: 'MyResourceType'
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientOther.disconnect();
                });
            });

            it('should fail if resource was never registered', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.unregisterResource('myResource1').should.be.rejectedWith({
                        status: 404,
                        response: 'No such resource'
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

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

        describe('#getVersions', function() {
            it('should return the devicejs version number and installed module version numbers', function() {
                var djsClient = newDJSClient();
                var devicejsVersion = require('../package.json').version;
                var dummyModules = { 
                    MOD1: {
                        name: 'MOD1',
                        version: '0.0.2',
                        enabled: true
                    },
                    MOD2: {
                        name: 'MOD2',
                        version: '0.3.3',
                        enabled: true
                    },
                    MOD3: {
                        name: 'MOD3',
                        version: '1.0.0',
                        enabled: false
                    }
                }; 

                return djsClient.connect().then(function() {
                    return rmrf(MODULE_INSTALL_DIRECTORY);
                }).then(function() {
                    return djsClient.getVersions().should.be.fulfilledWith({
                        devicejs: devicejsVersion,
                        modules: { }
                    });
                }).then(function() {
                    wrench.mkdirSyncRecursive(MODULE_INSTALL_DIRECTORY);
                    wrench.mkdirSyncRecursive(path.join(MODULE_INSTALL_DIRECTORY, 'installed'));
                    wrench.mkdirSyncRecursive(path.join(MODULE_INSTALL_DIRECTORY, 'enabled'));

                    Object.keys(dummyModules).forEach(function(moduleName) {
                        var moduleInfo = dummyModules[moduleName];
                        var moduleDirectory = path.join(MODULE_INSTALL_DIRECTORY, 'installed', moduleName);
                        var moduleSymlinkDirectory = path.join(MODULE_INSTALL_DIRECTORY, 'enabled', moduleName);

                        wrench.mkdirSyncRecursive(moduleDirectory);
                        fs.writeFileSync(path.join(moduleDirectory, 'devicejs.json'), JSON.stringify({
                            name: moduleName,
                            version: moduleInfo.version
                        }, 'utf8'));

                        if(moduleInfo.enabled) {
                            fs.symlinkSync(moduleDirectory, moduleSymlinkDirectory);
                        }
                    });
                }).then(function() {
                    return djsClient.getVersions().should.be.fulfilledWith({
                        devicejs: devicejsVersion,
                        modules: { 
                            MOD1: '0.0.2',
                            MOD2: '0.3.3',
                            MOD3: '1.0.0'
                        }
                    });
                }).then(function() {
                    return rmrf(MODULE_INSTALL_DIRECTORY);
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

        describe('#getModules', function() {
            it('should return the installed modules, their versions, and their status', function() {
                var djsClient = newDJSClient();

                var djsClient = newDJSClient();
                var devicejsVersion = require('../package.json').version;
                var dummyModules = { 
                    MOD1: {
                        name: 'MOD1',
                        version: '0.0.2',
                        enabled: true
                    },
                    MOD2: {
                        name: 'MOD2',
                        version: '0.3.3',
                        enabled: true
                    },
                    MOD3: {
                        name: 'MOD3',
                        version: '1.0.0',
                        enabled: false
                    }
                }; 

                return djsClient.connect().then(function() {
                    return rmrf(MODULE_INSTALL_DIRECTORY);
                }).then(function() {
                    return djsClient.getModules().should.be.fulfilledWith({ });
                }).then(function() {
                    wrench.mkdirSyncRecursive(MODULE_INSTALL_DIRECTORY);
                    wrench.mkdirSyncRecursive(path.join(MODULE_INSTALL_DIRECTORY, 'installed'));
                    wrench.mkdirSyncRecursive(path.join(MODULE_INSTALL_DIRECTORY, 'enabled'));

                    Object.keys(dummyModules).forEach(function(moduleName) {
                        var moduleInfo = dummyModules[moduleName];
                        var moduleDirectory = path.join(MODULE_INSTALL_DIRECTORY, 'installed', moduleName);
                        var moduleSymlinkDirectory = path.join(MODULE_INSTALL_DIRECTORY, 'enabled', moduleName);

                        wrench.mkdirSyncRecursive(moduleDirectory);
                        fs.writeFileSync(path.join(moduleDirectory, 'devicejs.json'), JSON.stringify({
                            name: moduleName,
                            version: moduleInfo.version
                        }, 'utf8'));

                        if(moduleInfo.enabled) {
                            fs.symlinkSync(moduleDirectory, moduleSymlinkDirectory);
                        }
                    });
                }).then(function() {
                    return djsClient.getModules().should.be.fulfilledWith(dummyModules);
                }).then(function() {
                    return rmrf(MODULE_INSTALL_DIRECTORY);
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

        describe('#createResourceGroup', function() {
            it('should succeed if group name is non-empty string', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.createResourceGroup('A');
                }).then(function() {
                    return djsClient.createResourceGroup('B');
                }).then(function() {
                    return djsClient.createResourceGroup('C');
                }).then(function() {
                    return djsClient.createResourceGroup('A/B/C');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            },
                            B: {
                                children: { },
                                resources: { }
                            },
                            C: {
                                children: { },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should succeed and have no effect if the resource group already exists', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.createResourceGroup('A/B/C');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.createResourceGroup('A/B/C');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if group name is an empty string, if it has slashes at the start or end, or has an empty path component', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.createResourceGroup('').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.createResourceGroup('/A/B/C').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.createResourceGroup().should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.createResourceGroup('//A/B').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.createResourceGroup('////').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.createResourceGroup('A/B/').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: { },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

        describe('#deleteResourceGroup', function() {
            var interfaceSchema = {
                name: 'MyInterfaceType',
                version: '0.0.1',
                commands: {
                    myCommand: {        
                        arguments: [ { type: 'string' } ],
                        returns: { type: 'number' }
                    }
                },
                state: {
                    myStateProperty: {
                        readOnly: true,
                        schema: { type: 'number' }
                    }
                },
                events: {
                    myEvent: {
                        schema: { type: 'number' }
                    }
                }
            };

            var resourceSchema = {
                name: 'MyResourceType',
                version: '0.0.1',
                interfaces: [ 'MyInterfaceType' ]
            };

            it('should succeed if group name is non-empty string and the group exists', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.createResourceGroup('A');
                }).then(function() {
                    return djsClient.createResourceGroup('B');
                }).then(function() {
                    return djsClient.createResourceGroup('C');
                }).then(function() {
                    return djsClient.createResourceGroup('A/B/C');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            },
                            B: {
                                children: { },
                                resources: { }
                            },
                            C: {
                                children: { },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup('A/B/C');
                }).then(function() {
                    return djsClient.deleteResourceGroup('B');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: { },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            },
                            C: {
                                children: { },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should cause all listeners to this resource group to stop seeing events from resources in this group', function() {
                var djsClient = newDJSClient();
                var djsClientController = newDJSClient();
                this.timeout(60000);

                return djsClient.connect().then(function() {
                    return djsClientController.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 3000);
                    });
                }).then(function() {
                    var groupSelection1 = djsClient.selectByGroup('A');
                    var groupSelection2 = djsClient.selectByGroup('A/B');
                    var groupSelection3 = djsClient.selectByGroup('A/B/C');

                    var eventsOccur = Promise.all([
                        new Promise(function(resolve, reject) {
                            groupSelection1.once('event', function(resourceID, eventName, eventData) {
                                console.log('got event1')
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            groupSelection2.once('event', function(resourceID, eventName, eventData) {
                                console.log('got event2')
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            groupSelection3.once('event', function(resourceID, eventName, eventData) {
                                console.log('got event3')
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        })
                    ]);
                    
                    return groupSelection1.subscribeToEvent('myEvent').then(function() {
                        return groupSelection2.subscribeToEvent('myEvent');
                    }).then(function() {
                        return groupSelection3.subscribeToEvent('myEvent');
                    }).then(function() {
                        return Promise.all([
                            eventsOccur,
                            djsClient.publishResourceEvent('myResource1', 'myEvent', 75)
                        ]);
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup('A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 5000);
                    });
                }).then(function() {
                    var groupSelection1 = djsClient.selectByGroup('A');
                    var groupSelection2 = djsClient.selectByGroup('A/B');
                    var groupSelection3 = djsClient.selectByGroup('A/B/C');
                    var eventCount = 0;

                    groupSelection1.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    groupSelection2.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    groupSelection3.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    
                    return groupSelection1.subscribeToEvent('myEvent').then(function() {
                        return groupSelection2.subscribeToEvent('myEvent');
                    }).then(function() {
                        return groupSelection3.subscribeToEvent('myEvent');
                    }).then(function() {
                        djsClient.publishResourceEvent('myResource1', 'myEvent', 68)

                        return new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                eventCount.should.be.eql(0);
                                resolve();
                            }, 5000);
                        });
                    });
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientController.disconnect();
                });
            });

            it('should cause resources placed into this group to stop receiving control events bound for this group', function() {
                var djsClient = newDJSClient();
                var djsClientController = newDJSClient();
                this.timeout(60000);

                return djsClient.connect().then(function() {
                    return djsClientController.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 3000);
                    });
                }).then(function() {
                }).then(function() {
                    var willReceiveControlMessages = {};
                    var commandReceiveMap = { 'first': false, 'second': false, 'third': false };
                    var setReceiveMap = { 22: false, 34: false, 69: false };
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByGroup('A').call('myCommand', 'first');
                    djsClientController.selectByGroup('A').set('myStateProperty', 22);
                    djsClientController.selectByGroup('A').get('myStateProperty');

                    djsClientController.selectByGroup('A/B').call('myCommand', 'second');
                    djsClientController.selectByGroup('A/B').set('myStateProperty', 34);
                    djsClientController.selectByGroup('A/B').get('myStateProperty');

                    djsClientController.selectByGroup('A/B/C').call('myCommand', 'third');
                    djsClientController.selectByGroup('A/B/C').set('myStateProperty', 69);
                    djsClientController.selectByGroup('A/B/C').get('myStateProperty');

                    return Promise.all([
                        new Promise(function(resolve, reject) {
                            djsClient.on('command', function(commandName, args) {
                                commandName.should.be.eql('myCommand');
                                args.should.be.Array();
                                commandReceiveMap.should.have.ownProperty(args[0]);
                                commandReceiveMap[args[0]] = true;

                                commandsReceived += 1;

                                if(commandsReceived == Object.keys(commandReceiveMap).length) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state get', function(property) {
                                property.should.be.eql('myStateProperty');

                                getsReceived += 1;

                                if(getsReceived == 3) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state set', function(property, value) {
                                property.should.be.eql('myStateProperty');
                                setReceiveMap.should.have.ownProperty(value);
                                setReceiveMap[value] = true;

                                setsReceived += 1;

                                if(setsReceived == Object.keys(setReceiveMap).length) {
                                    resolve();
                                }
                            });
                        })
                    ]).then(function() {
                        commandReceiveMap.should.be.eql({ 'first': true, 'second': true, 'third': true });
                        setReceiveMap.should.be.eql({ 22: true, 34: true, 69: true });
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup('A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 5000);
                    });
                }).then(function() {
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByGroup('A').call('myCommand', 'first');
                    djsClientController.selectByGroup('A').set('myStateProperty', 22);
                    djsClientController.selectByGroup('A').get('myStateProperty');

                    djsClientController.selectByGroup('A/B').call('myCommand', 'second');
                    djsClientController.selectByGroup('A/B').set('myStateProperty', 34);
                    djsClientController.selectByGroup('A/B').get('myStateProperty');

                    djsClientController.selectByGroup('A/B/C').call('myCommand', 'third');
                    djsClientController.selectByGroup('A/B/C').set('myStateProperty', 69);
                    djsClientController.selectByGroup('A/B/C').get('myStateProperty');

                    djsClient.on('command', function(commandName, args) {
                        commandsReceived += 1;
                    });
                    djsClient.on('state get', function(property) {
                        getsReceived += 1;
                    });
                    djsClient.on('state set', function(property, value) {
                        setsReceived += 1;
                    });

                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            commandsReceived.should.be.eql(0);
                            getsReceived.should.be.eql(0);
                            setsReceived.should.be.eql(0);
                            resolve();
                        }, 5000);
                    });
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientController.disconnect();
                });
            });

            it('should fail if group name is empty string', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.deleteResourceGroup('').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup('/A/B/C').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup().should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup('//A/B').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup('////').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup('A/B/').should.be.rejectedWith({
                        status: 400,
                        response: 'Invalid resource group name'
                    });
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: { },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should succeed and do nothing if group does not exist', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.createResourceGroup('A');
                }).then(function() {
                    return djsClient.createResourceGroup('B');
                }).then(function() {
                    return djsClient.createResourceGroup('C');
                }).then(function() {
                    return djsClient.createResourceGroup('A/B/C');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            },
                            B: {
                                children: { },
                                resources: { }
                            },
                            C: {
                                children: { },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.deleteResourceGroup('X').should.be.fulfilled();
                }).then(function() {
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            },
                            B: {
                                children: { },
                                resources: { }
                            },
                            C: {
                                children: { },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });

        describe('#joinResourceGroup', function() {
            var interfaceSchema = {
                name: 'MyInterfaceType',
                version: '0.0.1',
                commands: {
                    myCommand: {        
                        arguments: [ { type: 'string' } ],
                        returns: { type: 'number' }
                    }
                },
                state: {
                    myStateProperty: {
                        readOnly: true,
                        schema: { type: 'number' }
                    }
                },
                events: {
                    myEventType: {
                        schema: { type: 'string' }
                    }
                }
            };

            var resourceSchema = {
                name: 'MyResourceType',
                version: '0.0.1',
                interfaces: [ 'MyInterfaceType' ]
            };

            it('should succeed if resource has been registered', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: {
                                                    'myResource1': { }
                                                }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if resource is unknown', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C').should.be.rejectedWith({
                        status: 404,
                        response: 'No such resource'
                    });
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: { },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should cause the owner of the resource to receive control messages bound for this resource group', function() {
                var djsClient = newDJSClient();
                var djsClientController = newDJSClient();
                this.timeout(60000);

                return djsClient.connect().then(function() {
                    return djsClientController.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByGroup('A').call('myCommand', 'first');
                    djsClientController.selectByGroup('A').set('myStateProperty', 22);
                    djsClientController.selectByGroup('A').get('myStateProperty');

                    djsClientController.selectByGroup('A/B').call('myCommand', 'second');
                    djsClientController.selectByGroup('A/B').set('myStateProperty', 34);
                    djsClientController.selectByGroup('A/B').get('myStateProperty');

                    djsClientController.selectByGroup('A/B/C').call('myCommand', 'third');
                    djsClientController.selectByGroup('A/B/C').set('myStateProperty', 69);
                    djsClientController.selectByGroup('A/B/C').get('myStateProperty');

                    djsClient.on('command', function(commandName, args) {
                        commandsReceived += 1;
                    });
                    djsClient.on('state get', function(property) {
                        getsReceived += 1;
                    });
                    djsClient.on('state set', function(property, value) {
                        setsReceived += 1;
                    });

                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            commandsReceived.should.be.eql(0);
                            getsReceived.should.be.eql(0);
                            setsReceived.should.be.eql(0);
                            resolve();
                        }, 5000);
                    });
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 3000);
                    });
                }).then(function() {
                    var willReceiveControlMessages = {};
                    var commandReceiveMap = { 'first': false, 'second': false, 'third': false };
                    var setReceiveMap = { 22: false, 34: false, 69: false };
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByGroup('A').call('myCommand', 'first');
                    djsClientController.selectByGroup('A').set('myStateProperty', 22);
                    djsClientController.selectByGroup('A').get('myStateProperty');

                    djsClientController.selectByGroup('A/B').call('myCommand', 'second');
                    djsClientController.selectByGroup('A/B').set('myStateProperty', 34);
                    djsClientController.selectByGroup('A/B').get('myStateProperty');

                    djsClientController.selectByGroup('A/B/C').call('myCommand', 'third');
                    djsClientController.selectByGroup('A/B/C').set('myStateProperty', 69);
                    djsClientController.selectByGroup('A/B/C').get('myStateProperty');

                    return Promise.all([
                        new Promise(function(resolve, reject) {
                            djsClient.on('command', function(commandName, args) {
                                commandName.should.be.eql('myCommand');
                                args.should.be.Array();
                                commandReceiveMap.should.have.ownProperty(args[0]);
                                commandReceiveMap[args[0]] = true;

                                commandsReceived += 1;

                                if(commandsReceived == Object.keys(commandReceiveMap).length) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state get', function(property) {
                                property.should.be.eql('myStateProperty');

                                getsReceived += 1;

                                if(getsReceived == 3) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state set', function(property, value) {
                                property.should.be.eql('myStateProperty');
                                setReceiveMap.should.have.ownProperty(value);
                                setReceiveMap[value] = true;

                                setsReceived += 1;

                                if(setsReceived == Object.keys(setReceiveMap).length) {
                                    resolve();
                                }
                            });
                        })
                    ]).then(function() {
                        commandReceiveMap.should.be.eql({ 'first': true, 'second': true, 'third': true });
                        setReceiveMap.should.be.eql({ 22: true, 34: true, 69: true });
                    });
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientController.disconnect();
                });
            });

            it('should cause listeners to this resource group to start seeing events from this resource', function() {
                var djsClient = newDJSClient();
                var djsClientController = newDJSClient();
                this.timeout(60000);

                return djsClient.connect().then(function() {
                    return djsClientController.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    var groupSelection1 = djsClient.selectByGroup('A');
                    var groupSelection2 = djsClient.selectByGroup('A/B');
                    var groupSelection3 = djsClient.selectByGroup('A/B/C');
                    var eventCount = 0;

                    groupSelection1.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    groupSelection2.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    groupSelection3.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    
                    return groupSelection1.subscribeToEvent('myEvent').then(function() {
                        return groupSelection2.subscribeToEvent('myEvent');
                    }).then(function() {
                        return groupSelection3.subscribeToEvent('myEvent');
                    }).then(function() {
                        djsClient.publishResourceEvent('myResource1', 'myEvent', 68)

                        return new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                eventCount.should.be.eql(0);
                                resolve();
                            }, 5000);
                        });
                    });
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 3000);
                    });
                }).then(function() {
                    var groupSelection1 = djsClient.selectByGroup('A');
                    var groupSelection2 = djsClient.selectByGroup('A/B');
                    var groupSelection3 = djsClient.selectByGroup('A/B/C');

                    var eventsOccur = Promise.all([
                        new Promise(function(resolve, reject) {
                            groupSelection1.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            groupSelection2.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            groupSelection3.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        })
                    ]);
                    
                    return groupSelection1.subscribeToEvent('myEvent').then(function() {
                        return groupSelection2.subscribeToEvent('myEvent');
                    }).then(function() {
                        return groupSelection3.subscribeToEvent('myEvent');
                    }).then(function() {
                        return Promise.all([
                            eventsOccur,
                            djsClient.publishResourceEvent('myResource1', 'myEvent', 75)
                        ]);
                    }); 
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientController.disconnect();
                });
            });
        });

        describe('#leaveResourceGroup', function() {
            var interfaceSchema = {
                name: 'MyInterfaceType',
                version: '0.0.1',
                commands: {
                    myCommand: {        
                        arguments: [ { type: 'string' } ],
                        returns: { type: 'number' }
                    }
                },
                state: {
                    myStateProperty: {
                        readOnly: true,
                        schema: { type: 'number' }
                    }
                },
                events: {
                    myEventType: {
                        schema: { type: 'string' }
                    }
                }
            };

            var resourceSchema = {
                name: 'MyResourceType',
                version: '0.0.1',
                interfaces: [ 'MyInterfaceType' ]
            };

            it('should succeed if resource is currently in the specified group', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: {
                                                    'myResource1': { }
                                                }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.leaveResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if resource is not in the specified group', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: { },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.leaveResourceGroup('myResource1', 'A/B/C').should.be.fulfilled();
                }).then(function() {
                    console.log('BEFORE!')
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: { },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should cause the owner of the resource to stop receiving control messages bound for this resource group', function() {
                var djsClient = newDJSClient();
                var djsClientController = newDJSClient();
                this.timeout(60000);

                return djsClient.connect().then(function() {
                    return djsClientController.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 3000);
                    });
                }).then(function() {
                }).then(function() {
                    var willReceiveControlMessages = {};
                    var commandReceiveMap = { 'first': false, 'second': false, 'third': false };
                    var setReceiveMap = { 22: false, 34: false, 69: false };
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByGroup('A').call('myCommand', 'first');
                    djsClientController.selectByGroup('A').set('myStateProperty', 22);
                    djsClientController.selectByGroup('A').get('myStateProperty');

                    djsClientController.selectByGroup('A/B').call('myCommand', 'second');
                    djsClientController.selectByGroup('A/B').set('myStateProperty', 34);
                    djsClientController.selectByGroup('A/B').get('myStateProperty');

                    djsClientController.selectByGroup('A/B/C').call('myCommand', 'third');
                    djsClientController.selectByGroup('A/B/C').set('myStateProperty', 69);
                    djsClientController.selectByGroup('A/B/C').get('myStateProperty');

                    return Promise.all([
                        new Promise(function(resolve, reject) {
                            djsClient.on('command', function(commandName, args) {
                                commandName.should.be.eql('myCommand');
                                args.should.be.Array();
                                commandReceiveMap.should.have.ownProperty(args[0]);
                                commandReceiveMap[args[0]] = true;

                                commandsReceived += 1;

                                if(commandsReceived == Object.keys(commandReceiveMap).length) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state get', function(property) {
                                property.should.be.eql('myStateProperty');

                                getsReceived += 1;

                                if(getsReceived == 3) {
                                    resolve();
                                }
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            djsClient.on('state set', function(property, value) {
                                property.should.be.eql('myStateProperty');
                                setReceiveMap.should.have.ownProperty(value);
                                setReceiveMap[value] = true;

                                setsReceived += 1;

                                if(setsReceived == Object.keys(setReceiveMap).length) {
                                    resolve();
                                }
                            });
                        })
                    ]).then(function() {
                        commandReceiveMap.should.be.eql({ 'first': true, 'second': true, 'third': true });
                        setReceiveMap.should.be.eql({ 22: true, 34: true, 69: true });
                    });
                }).then(function() {
                    return djsClient.leaveResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 5000);
                    });
                }).then(function() {
                    var commandsReceived = 0;
                    var setsReceived = 0;
                    var getsReceived = 0;

                    djsClientController.selectByGroup('A').call('myCommand', 'first');
                    djsClientController.selectByGroup('A').set('myStateProperty', 22);
                    djsClientController.selectByGroup('A').get('myStateProperty');

                    djsClientController.selectByGroup('A/B').call('myCommand', 'second');
                    djsClientController.selectByGroup('A/B').set('myStateProperty', 34);
                    djsClientController.selectByGroup('A/B').get('myStateProperty');

                    djsClientController.selectByGroup('A/B/C').call('myCommand', 'third');
                    djsClientController.selectByGroup('A/B/C').set('myStateProperty', 69);
                    djsClientController.selectByGroup('A/B/C').get('myStateProperty');

                    djsClient.on('command', function(commandName, args) {
                        commandsReceived += 1;
                    });
                    djsClient.on('state get', function(property) {
                        getsReceived += 1;
                    });
                    djsClient.on('state set', function(property, value) {
                        setsReceived += 1;
                    });

                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            commandsReceived.should.be.eql(0);
                            getsReceived.should.be.eql(0);
                            setsReceived.should.be.eql(0);
                            resolve();
                        }, 5000);
                    });
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientController.disconnect();
                });           
            });

            it('should cause listeners to this resource group to stop seeing events from this resource', function() {
                var djsClient = newDJSClient();
                var djsClientController = newDJSClient();
                this.timeout(60000);

                return djsClient.connect().then(function() {
                    return djsClientController.connect();
                }).then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 3000);
                    });
                }).then(function() {
                    var groupSelection1 = djsClient.selectByGroup('A');
                    var groupSelection2 = djsClient.selectByGroup('A/B');
                    var groupSelection3 = djsClient.selectByGroup('A/B/C');

                    var eventsOccur = Promise.all([
                        new Promise(function(resolve, reject) {
                            groupSelection1.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            groupSelection2.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        }),
                        new Promise(function(resolve, reject) {
                            groupSelection3.once('event', function(resourceID, eventName, eventData) {
                                resourceID.should.be.eql('myResource1');
                                eventName.should.be.eql('myEvent');
                                eventData.should.be.eql(75);
                                resolve();
                            });
                        })
                    ]);
                    
                    return groupSelection1.subscribeToEvent('myEvent').then(function() {
                        return groupSelection2.subscribeToEvent('myEvent');
                    }).then(function() {
                        return groupSelection3.subscribeToEvent('myEvent');
                    }).then(function() {
                        return Promise.all([
                            eventsOccur,
                            djsClient.publishResourceEvent('myResource1', 'myEvent', 75)
                        ]);
                    });
                }).then(function() {
                    return djsClient.leaveResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve();
                        }, 5000);
                    });
                }).then(function() {
                    var groupSelection1 = djsClient.selectByGroup('A');
                    var groupSelection2 = djsClient.selectByGroup('A/B');
                    var groupSelection3 = djsClient.selectByGroup('A/B/C');
                    var eventCount = 0;

                    groupSelection1.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    groupSelection2.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    groupSelection3.once('event', function(resourceID, eventName, eventData) {
                        eventCount += 1;
                    });
                    
                    return groupSelection1.subscribeToEvent('myEvent').then(function() {
                        return groupSelection2.subscribeToEvent('myEvent');
                    }).then(function() {
                        return groupSelection3.subscribeToEvent('myEvent');
                    }).then(function() {
                        djsClient.publishResourceEvent('myResource1', 'myEvent', 68)

                        return new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                eventCount.should.be.eql(0);
                                resolve();
                            }, 5000);
                        });
                    });
                }).then(function() {
                    return djsClient.disconnect();
                }).then(function() {
                    return djsClientController.disconnect();
                });
            });
        });

        describe('#getResourceGroup', function() {
            var interfaceSchema = {
                name: 'MyInterfaceType',
                version: '0.0.1',
                commands: {
                    myCommand: {        
                        arguments: [ { type: 'string' } ],
                        returns: { type: 'number' }
                    }
                },
                state: {
                    myStateProperty: {
                        readOnly: true,
                        schema: { type: 'number' }
                    }
                },
                events: {
                    myEventType: {
                        schema: { type: 'string' }
                    }
                }
            };

            var resourceSchema = {
                name: 'MyResourceType',
                version: '0.0.1',
                interfaces: [ 'MyInterfaceType' ]
            };

            it('should return a hierarchy of locations starting at the specified parent group', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.registerResource('myResource2', 'MyResourceType');
                }).then(function() {
                    return djsClient.registerResource('myResource3', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource2', 'A/B/C');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource3', 'G/E/F');
                }).then(function() {
                    return djsClient.getResourceGroup('A').should.be.fulfilledWith({
                        children: {
                            B: {
                                children: {
                                    C: {
                                        children: { },
                                        resources: { 
                                            'myResource1': { },
                                            'myResource2': { }
                                        }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.getResourceGroup('A/B').should.be.fulfilledWith({
                        children: {
                            C: {
                                children: { },
                                resources: { 
                                    'myResource1': { },
                                    'myResource2': { }
                                }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.getResourceGroup('A/B/C').should.be.fulfilledWith({
                        children: { },
                        resources: { 
                            'myResource1': { },
                            'myResource2': { }
                        }
                    });
                }).then(function() {
                    return djsClient.getResourceGroup('G').should.be.fulfilledWith({
                        children: {
                            E: {
                                children: {
                                    F: {
                                        children: { },
                                        resources: { 
                                            'myResource3': { }
                                        }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.getResourceGroup('G/E').should.be.fulfilledWith({
                        children: {
                            F: {
                                children: { },
                                resources: { 
                                    'myResource3': { }
                                }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.getResourceGroup('G/E/F').should.be.fulfilledWith({
                        children: { },
                        resources: { 
                            'myResource3': { }
                        }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should return total hierarchy if group name is not specified', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.registerResource('myResource2', 'MyResourceType');
                }).then(function() {
                    return djsClient.registerResource('myResource3', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource2', 'A/B/C');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource3', 'G/E/F');
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { 
                                                    'myResource1': { },
                                                    'myResource2': { }
                                                }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            },
                            G: {
                                children: {
                                    E: {
                                        children: {
                                            F: {
                                                children: { },
                                                resources: { 
                                                    'myResource3': { }
                                                }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should return total hierarchy if group name is an empty string', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.registerResource('myResource1', 'MyResourceType');
                }).then(function() {
                    return djsClient.registerResource('myResource2', 'MyResourceType');
                }).then(function() {
                    return djsClient.registerResource('myResource3', 'MyResourceType');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource1', 'A/B/C');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource2', 'A/B/C');
                }).then(function() {
                    return djsClient.joinResourceGroup('myResource3', 'G/E/F');
                }).then(function() {
                    return djsClient.getResourceGroup('').should.be.fulfilledWith({
                        children: {
                            A: {
                                children: {
                                    B: {
                                        children: {
                                            C: {
                                                children: { },
                                                resources: { 
                                                    'myResource1': { },
                                                    'myResource2': { }
                                                }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            },
                            G: {
                                children: {
                                    E: {
                                        children: {
                                            F: {
                                                children: { },
                                                resources: { 
                                                    'myResource3': { }
                                                }
                                            }
                                        },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should return an empty object if total hierarchy is queried with no groups created', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.getResourceGroup('').should.be.fulfilledWith({ 
                        children: { },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.getResourceGroup().should.be.fulfilledWith({ 
                        children: { },
                        resources: { }
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });

            it('should fail if a group is queried that doesnt exist', function() {
                var djsClient = newDJSClient();

                return djsClient.connect().then(function() {
                    return djsClient.addInterfaceType(interfaceSchema);
                }).then(function() {
                    return djsClient.addResourceType(resourceSchema);
                }).then(function() {
                    return djsClient.getResourceGroup('A').should.be.rejectedWith({ 
                        status: 404,
                        response: 'No such group'
                    });
                }).then(function() {
                    return djsClient.disconnect();
                });
            });
        });
    });

    describe('ResourceSelection', function() {
        var interfaceTypes = {
            InterfaceType1: {
                name: 'InterfaceType1',
                version: '0.0.1',
                commands: { },
                state: { 
                    stateProperty1: { 
                        readOnly: false,
                        schema: { type: 'string' }
                    },
                    stateProperty11: { 
                        readOnly: false,
                        schema: { type: 'string' }
                    }
                },
                events: {
                    eventType1: {
                        schema: { type: 'string' }
                    },
                    eventType11: {
                        schema: { type: 'string' }
                    }
                }
            },
            InterfaceType2: {
                name: 'InterfaceType2',
                version: '0.0.1',
                commands: { },
                state: { 
                    stateProperty2: { 
                        readOnly: false,
                        schema: { type: 'string' }
                    },
                    stateProperty22: { 
                        readOnly: false,
                        schema: { type: 'string' }
                    }
                },
                events: {
                    eventType2: {
                        schema: { type: 'string' }
                    },
                    eventType22: {
                        schema: { type: 'string' }
                    }
                }
            },
            InterfaceType3: {
                name: 'InterfaceType3',
                version: '0.0.1',
                commands: { },
                state: { 
                    stateProperty3: { 
                        readOnly: false,
                        schema: { type: 'string' }
                    },
                    stateProperty33: { 
                        readOnly: false,
                        schema: { type: 'string' }
                    }
                },
                events: {
                    eventType3: {
                        schema: { type: 'string' }
                    },
                    eventType33: {
                        schema: { type: 'string' }
                    }
                }
            },
            InterfaceType4: {
                name: 'InterfaceType4',
                version: '0.0.1',
                commands: { },
                state: { 
                    stateProperty4: { 
                        readOnly: false,
                        schema: { type: 'string' }
                    },
                    stateProperty44: { 
                        readOnly: false,
                        schema: { type: 'string' }
                    }
                },
                events: {
                    eventType4: {
                        schema: { type: 'string' }
                    },
                    eventType44: {
                        schema: { type: 'string' }
                    }
                }
            }
        };

        var resourceTypes = {
            ResourceType1: {
                name: 'ResourceType1',
                version: '0.0.1',
                interfaces: [ 'InterfaceType1', 'InterfaceType2' ]
            },
            ResourceType2: {
                name: 'ResourceType2',
                version: '0.0.1',
                interfaces: [ 'InterfaceType3', 'InterfaceType4' ]
            },
            ResourceType3: {
                name: 'ResourceType3',
                version: '0.0.1',
                interfaces: [ 'InterfaceType2', 'InterfaceType3' ]
            },
            ResourceType4: {
                name: 'ResourceType4',
                version: '0.0.1',
                interfaces: [ 'InterfaceType1', 'InterfaceType4' ]
            }
        };

        beforeEach(function() {
            // Clear database
            coreServer = new devicejs.DeviceJSCore(DEVICEJS_PORT, { 
                moduleInstallDirectory: MODULE_INSTALL_DIRECTORY,
                databaseConfig: {
                    uri: 'https://127.0.0.1:'+DEVICEDB_PORT,
                    https: {
                        ca: ddbCA
                    }
                },
                jwtSecret: 'myJWTSecretTemporary',
                nodeID: 'abc123'
            });

            //return ddbServer.start().then(function() {
            return ddbServer.stop().then(function() {
                return ddbServer.start()
            }).then(function() {
                return coreServer.start()
            }).then(function() {
            });
        });

        afterEach(function() {
            this.timeout(60000);
            //return ddbServer.stop().then(function() {
            //}, function(error) {
            //}).then(function() {
            console.log('kill the core server')
                return coreServer.stop().then(function() {
            console.log('killed')
                }, function(error) {
                });
            //});
        });

        describe('#subscribeToEvent', function() { 
            function doEventSubscriptionTest(testConfiguration) {
                var subscribeSet = testConfiguration.subscribeSet;
                var eventSet = testConfiguration.eventSet;
                var listenTime = testConfiguration.listenTime;
                var resourceClient = newDJSClient();
                var listenClient = newDJSClient();
                var sendEventIntervals = [ ];

                return resourceClient.connect().then(function() {
                    return listenClient.connect();
                }).then(function() {
                    return Promise.all(Object.keys(interfaceTypes).map(function(k) {
                        return resourceClient.addInterfaceType(interfaceTypes[k]);
                    }));
                }).then(function() {
                    return Promise.all(Object.keys(resourceTypes).map(function(k) {
                        return resourceClient.addResourceType(resourceTypes[k]);
                    }));
                }).then(function() {
                    var id = 0;

                    // Register 4 of each type of resource
                    // Start emitting events for these all of these resources
                    // every two seconds
                    return Promise.all(Object.keys(resourceTypes).map(function(resourceType) { 
                        var interfaces = resourceTypes[resourceType].interfaces;
                        var events = [ ];

                        interfaces.forEach(function(interfaceName) {
                            events.push.apply(events, Object.keys(interfaceTypes[interfaceName].events));
                        });

                        return Promise.all([++id, ++id, ++id, ++id].map(function(id) {
                            return resourceClient.registerResource('myResource' + id, resourceType).then(function() {
                                // for each registered resource, it should emit all types of events that it can emit every
                                // two seconds
                                sendEventIntervals.push(setInterval(function() {
                                    events.forEach(function(event) {
                                        resourceClient.publishResourceEvent('myResource' + id, event, ''+Math.random());
                                    });
                                }, 2000));
                            });
                        }))
                    })).then(function() {
                        return resourceClient.joinResourceGroup('myResource1', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource5', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource9', 'A/B');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource13', 'A');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource2', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource10', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource6', 'X/Y');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource14', 'X');
                    }).then(function() {
                    }).then(function() {
                    });
                }).then(function() {
                    var selection = listenClient[subscribeSet.selectionType].call(listenClient, subscribeSet.selection);
                    var seenFrom = { };

                    return Promise.all(Object.keys(subscribeSet.events).map(function(eventName) {
                        //console.log(subscribeSet.selectionType, subscribeSet.selection, 'subscribing to', eventName);
                        return selection.subscribeToEvent(eventName);
                    })).then(function() {
                        selection.on('event', function(resourceID, eventName, eventData) {
                            //console.log('Saw', resourceID, eventName, eventData);
                            if(eventName == 'discovery') { return }
                            seenFrom[eventName] = seenFrom[eventName] || { };
                            seenFrom[eventName][resourceID] = seenFrom[eventName][resourceID] || 0;
                            seenFrom[eventName][resourceID] += 1;
                        });

                        return new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                resolve();
                            }, listenTime)
                        });
                    }).then(function() {
                        // the same number of types of events were seen as expected
                        //console.log('SEEN FROM', seenFrom);
                        //console.log('EXPECTED', eventSet);
                        Object.keys(seenFrom).length.should.be.eql(Object.keys(eventSet).length);

                        // make sure that the event types that we saw are all expected event types
                        Object.keys(seenFrom).forEach(function(eventName) {
                            eventSet.should.have.ownProperty(eventName);

                            // make sure that we received the event type from the expected number of resources
                            Object.keys(seenFrom[eventName]).length.should.be.eql(Object.keys(eventSet[eventName]).length);

                            // make sure that the set of resources that we received this event from is correct
                            // and that we received each event from each resource the expected number of times
                            Object.keys(seenFrom[eventName]).forEach(function(resourceID) {
                                var seenEventCount = seenFrom[eventName][resourceID];
                                var expectedEventCount = eventSet[eventName][resourceID];

                                //console.log('Seen from', eventName, resourceID, seenEventCount);
                                //console.log('Expected from', eventName, resourceID, expectedEventCount);
                                seenEventCount.should.be.approximately(expectedEventCount, 1);
                            });
                        });
                    });
                }).then(function() {
                    sendEventIntervals.forEach(function(i) {
                        clearInterval(i);
                    });
                    return resourceClient.disconnect();
                }).then(function() {
                    return listenClient.disconnect();
                });
            }

            // byInterface
            it('subscribing by interface to a specific event should result in seeing that event from all resources that are registered of that interface', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        events: { 
                            'eventType1': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by interface to a set of events should result in seeing all those types of events from all resources that are registered of that interface', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        events: { 
                            'eventType1': {
                            },
                            'eventType11': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType11': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by interface to all events should result in seeing all types of events from all resources that are registered of that interface', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        events: { 
                            '+': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType11': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType2': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3
                        },
                        'eventType22': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3
                        },
                        'eventType4': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3
                        },
                        'eventType44': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            // byType
            it('subscribing by resource type to a specific event should result in seeing that event from all resources that are registered of that resource type', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: 'ResourceType4',
                        events: { 
                            'eventType4': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType4': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by resource type to a set of events should result in seeing all those types of events from all resources that are registered of that resource type', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: 'ResourceType4',
                        events: { 
                            'eventType1': {
                            },
                            'eventType11': {
                            },
                            'eventType44': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType11': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType44': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by resource type to all events should result in seeing all types of events from all resources that are registered of that resource type', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: 'ResourceType4',
                        events: { 
                            '+': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType11': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType4': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType44': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to a specific type of event on all resource types should result in receiving that type of events from all resources that emit it', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: '+',
                        events: { 
                            'eventType4': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to a set of of events on all resource types should result in receiving those types of events from all resources that emit them', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: '+',
                        events: { 
                            'eventType4': {
                            },
                            'eventType3': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType3': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to all events on all resource types should result in receiving all types of events from all resources', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: '+',
                        events: { 
                            '+': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType11': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType2': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'eventType22': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'eventType3': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'eventType33': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'eventType4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType44': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            // byID
            it('subscribing by id to a specific event should result in seeing that event from that resource', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: 'myResource1',
                        events: { 
                            'eventType2': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType2': {
                            'myResource1': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by id to a set of events should result in seeing all those types of events from that resource', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: 'myResource1',
                        events: { 
                            'eventType2': {
                            },
                            'eventType1': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3
                        },
                        'eventType2': {
                            'myResource1': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by id to all events should result in seeing all types of events from that resource', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: 'myResource1',
                        events: { 
                            '+': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3
                        },
                        'eventType11': {
                            'myResource1': 3
                        },
                        'eventType2': {
                            'myResource1': 3
                        },
                        'eventType22': {
                            'myResource1': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to all ids to a particular event should result in seeing that type of event from all resources', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: '+',
                        events: { 
                            'eventType4': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to all ids to a set of events should result in seeing those types of events from all resources', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: '+',
                        events: { 
                            'eventType4': {
                            },
                            'eventType3': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType3': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to all ids to a all events should result in seeing all events', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: '+',
                        events: { 
                            '+': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType11': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType2': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'eventType22': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'eventType3': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'eventType33': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'eventType4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'eventType44': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            // byGroup
            it('subscribing by group to a specific event should result in seeing that event from any resource that emits it in that group or its children', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByGroup',
                        selection: 'A/B/C',
                        events: { 
                            'eventType2': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType2': {
                            'myResource1': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by group to a set of events should result in seeing all those types of events from any resource that emits them in that group or its children', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByGroup',
                        selection: 'A/B/C',
                        events: { 
                            'eventType2': {
                            },
                            'eventType4': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType2': {
                            'myResource1': 3
                        },
                        'eventType4': {
                            'myResource5': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by group to all events should result in seeing all types of events from all resources in that group or its children', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByGroup',
                        selection: 'A/B/C',
                        events: { 
                            '+': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3
                        },
                        'eventType11': {
                            'myResource1': 3
                        },
                        'eventType2': {
                            'myResource1': 3
                        },
                        'eventType22': {
                            'myResource1': 3
                        },
                        'eventType3': {
                            'myResource5': 3
                        },
                        'eventType33': {
                            'myResource5': 3
                        },
                        'eventType4': {
                            'myResource5': 3
                        },
                        'eventType44': {
                            'myResource5': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to an empty-string location name is the root group', function() {
                this.timeout(60000);
                return doEventSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByGroup',
                        selection: '+', // TODO this doesn't make a lot of sense
                        events: { 
                            'eventType1': {
                            }
                        }
                    },
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource13': 3,
                            'myResource14': 3
                        }
                    },
                    listenTime: 8000
                });
            });
        });

        describe('#unsubscribeFromEvent', function() {
            function doEventUnsubscribeTest(testConfiguration) {
                var subscribeSet = testConfiguration.subscribeSet;
                var unsubscribeSet = testConfiguration.unsubscribeSet;
                var eventSet = testConfiguration.eventSet;
                var listenTime = testConfiguration.listenTime;
                var resourceClient = newDJSClient();
                var listenClient = newDJSClient();
                var sendEventIntervals = [ ];

                return resourceClient.connect().then(function() {
                    return listenClient.connect();
                }).then(function() {
                    return Promise.all(Object.keys(interfaceTypes).map(function(k) {
                        //console.log('Add interface type', k, interfaceTypes[k]);
                        return resourceClient.addInterfaceType(interfaceTypes[k]);
                    }));
                }).then(function() {
                    return Promise.all(Object.keys(resourceTypes).map(function(k) {
                        //console.log('Add resource type', k);
                        return resourceClient.addResourceType(resourceTypes[k]);
                    }));
                }).then(function() {
                    var id = 0;

                    // Register 4 of each type of resource
                    // Start emitting events for these all of these resources
                    // every two seconds
                    return Promise.all(Object.keys(resourceTypes).map(function(resourceType) { 
                        var interfaces = resourceTypes[resourceType].interfaces;
                        var events = [ ];

                        interfaces.forEach(function(interfaceName) {
                            events.push.apply(events, Object.keys(interfaceTypes[interfaceName].events));
                        });

                        return Promise.all([++id, ++id, ++id, ++id].map(function(id) {
                            return resourceClient.registerResource('myResource' + id, resourceType).then(function() {
                                // for each registered resource, it should emit all types of events that it can emit every
                                // two seconds
                                sendEventIntervals.push(setInterval(function() {
                                    events.forEach(function(event) {
                                        resourceClient.publishResourceEvent('myResource' + id, event, ''+Math.random());
                                    });
                                }, 2000));
                            });
                        }))
                    })).then(function() {
                        return resourceClient.joinResourceGroup('myResource1', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource5', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource9', 'A/B');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource13', 'A');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource2', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource10', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource6', 'X/Y');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource14', 'X');
                    }).then(function() {
                    }).then(function() {
                    });
                }).then(function() {
                    var selection = listenClient[subscribeSet.selectionType].call(listenClient, subscribeSet.selection);
                    var seenFrom = { };

                    return Promise.all(Object.keys(subscribeSet.events).map(function(eventName) {
                        //console.log(subscribeSet.selectionType, subscribeSet.selection, 'subscribing to', eventName);
                        return selection.subscribeToEvent(eventName);
                    })).then(function(results) {
                        return Promise.all(unsubscribeSet.map(function(index) {
                            //console.log(unsubscribeSet.selectionType, unsubscribeSet.selection, 'unsubscribing from', eventName);
                            //return unsubscribeSelection.unsubscribeFromEvent(eventName);
                            return selection.unsubscribe(results[index].id)
                        }));
                    }).then(function() {
                        selection.on('event', function(resourceID, eventName, eventData) {
                            //console.log('Saw', resourceID, eventName, eventData);
                            seenFrom[eventName] = seenFrom[eventName] || { };
                            seenFrom[eventName][resourceID] = seenFrom[eventName][resourceID] || 0;
                            seenFrom[eventName][resourceID] += 1;
                        });

                        return new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                resolve();
                            }, listenTime)
                        });
                    }).then(function() {
                        // the same number of types of events were seen as expected
                        //console.log('SEEN FROM', seenFrom);
                        //console.log('EXPECTED', eventSet);
                        Object.keys(seenFrom).length.should.be.eql(Object.keys(eventSet).length);

                        // make sure that the event types that we saw are all expected event types
                        Object.keys(seenFrom).forEach(function(eventName) {
                            eventSet.should.have.ownProperty(eventName);

                            // make sure that we received the event type from the expected number of resources
                            Object.keys(seenFrom[eventName]).length.should.be.eql(Object.keys(eventSet[eventName]).length);

                            // make sure that the set of resources that we received this event from is correct
                            // and that we received each event from each resource the expected number of times
                            Object.keys(seenFrom[eventName]).forEach(function(resourceID) {
                                var seenEventCount = seenFrom[eventName][resourceID];
                                var expectedEventCount = eventSet[eventName][resourceID];

                                //console.log('Seen from', eventName, resourceID, seenEventCount);
                                //console.log('Expected from', eventName, resourceID, expectedEventCount);
                                seenEventCount.should.be.approximately(expectedEventCount, 1);
                            });
                        });
                    });
                }).then(function() {
                    sendEventIntervals.forEach(function(i) {
                        clearInterval(i);
                    });

                    return resourceClient.disconnect();
                }).then(function() {
                    return listenClient.disconnect();
                });
            }

            it('unsubscribing from a particular event should prevent seeing any of that type of event', function() {
                this.timeout(60000);
                return doEventUnsubscribeTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        events: { 
                            'eventType1': {
                            },
                            'eventType11': {
                            }
                        }
                    },
                    unsubscribeSet: [ 1 ],
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('unsubscribing from events wildcard results in no events seen if subscribed to wildcard', function() {
                this.timeout(60000);
                return doEventUnsubscribeTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        events: { 
                            '+': {
                            }
                        }
                    },
                    unsubscribeSet: [ 0 ],
                    eventSet: {
                    },
                    listenTime: 8000
                });
            });

            it('unsubscribing from events wildcard should not affect subscriptions to specific topics', function() {
                this.timeout(60000);
                return doEventUnsubscribeTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        events: { 
                            '+': {
                            },
                            'eventType1': {
                            }
                        }
                    },
                    unsubscribeSet: [ 0 ],
                    eventSet: {
                        'eventType1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                    },
                    listenTime: 8000
                });
            });
        });

        describe('#subscribeToState', function() {
            function doStateSubscriptionTest(testConfiguration) {
                var subscribeSet = testConfiguration.subscribeSet;
                var stateSet = testConfiguration.stateSet;
                var listenTime = testConfiguration.listenTime;
                var resourceClient = newDJSClient();
                var listenClient = newDJSClient();
                var sendEventIntervals = [ ];

                return resourceClient.connect().then(function() {
                    return listenClient.connect();
                }).then(function() {
                    return Promise.all(Object.keys(interfaceTypes).map(function(k) {
                        //console.log('Add interface type', k, interfaceTypes[k]);
                        return resourceClient.addInterfaceType(interfaceTypes[k]);
                    }));
                }).then(function() {
                    return Promise.all(Object.keys(resourceTypes).map(function(k) {
                        //console.log('Add resource type', k);
                        return resourceClient.addResourceType(resourceTypes[k]);
                    }));
                }).then(function() {
                    var id = 0;

                    // Register 4 of each type of resource
                    // Start emitting states for these all of these resources
                    // every two seconds
                    return Promise.all(Object.keys(resourceTypes).map(function(resourceType) { 
                        var interfaces = resourceTypes[resourceType].interfaces;
                        var states = [ ];

                        interfaces.forEach(function(interfaceName) {
                            states.push.apply(states, Object.keys(interfaceTypes[interfaceName].state));
                        });

                        return Promise.all([++id, ++id, ++id, ++id].map(function(id) {
                            return resourceClient.registerResource('myResource' + id, resourceType).then(function() {
                                // for each registered resource, it should emit all types of states that it can emit every
                                // two seconds
                                sendEventIntervals.push(setInterval(function() {
                                    states.forEach(function(state) {
                                        resourceClient.publishResourceStateChange('myResource' + id, state, ''+Math.random());
                                    });
                                }, 2000));
                            });
                        }));
                    })).then(function() {
                        return resourceClient.joinResourceGroup('myResource1', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource5', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource9', 'A/B');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource13', 'A');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource2', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource10', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource6', 'X/Y');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource14', 'X');
                    }).then(function() {
                    }).then(function() {
                    });
                }).then(function() {
                    var selection = listenClient[subscribeSet.selectionType].call(listenClient, subscribeSet.selection);
                    var seenFrom = { };

                    return Promise.all(Object.keys(subscribeSet.states).map(function(stateName) {
                        //console.log(subscribeSet.selectionType, subscribeSet.selection, 'subscribing to', stateName);
                        return selection.subscribeToState(stateName);
                    })).then(function() {
                        selection.on('state', function(resourceID, stateName, stateData) {
                            //console.log('Saw', resourceID, stateName, stateData);
                            seenFrom[stateName] = seenFrom[stateName] || { };
                            seenFrom[stateName][resourceID] = seenFrom[stateName][resourceID] || 0;
                            seenFrom[stateName][resourceID] += 1;
                        });

                        return new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                resolve();
                            }, listenTime)
                        });
                    }).then(function() {
                        // the same number of types of states were seen as expected
                        //console.log('SEEN FROM', seenFrom);
                        //console.log('EXPECTED', stateSet);
                        Object.keys(seenFrom).length.should.be.eql(Object.keys(stateSet).length);

                        // make sure that the state types that we saw are all expected state types
                        Object.keys(seenFrom).forEach(function(stateName) {
                            stateSet.should.have.ownProperty(stateName);

                            // make sure that we received the state type from the expected number of resources
                            Object.keys(seenFrom[stateName]).length.should.be.eql(Object.keys(stateSet[stateName]).length);

                            // make sure that the set of resources that we received this state from is correct
                            // and that we received each state from each resource the expected number of times
                            Object.keys(seenFrom[stateName]).forEach(function(resourceID) {
                                var seenStateCount = seenFrom[stateName][resourceID];
                                var expectedStateCount = stateSet[stateName][resourceID];

                                //console.log('Seen from', stateName, resourceID, seenStateCount);
                                //console.log('Expected from', stateName, resourceID, expectedStateCount);
                                seenStateCount.should.be.approximately(expectedStateCount, 1);
                            });
                        });
                    });
                }).then(function() {
                    sendEventIntervals.forEach(function(i) {
                        clearInterval(i);
                    });
                    return resourceClient.disconnect();
                }).then(function() {
                    return listenClient.disconnect();
                });
            }

            // byInterface
            it('subscribing by interface to a specific state should result in seeing that state from all resources that are registered of that interface', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        states: { 
                            'stateProperty1': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by interface to a set of states should result in seeing all those types of states from all resources that are registered of that interface', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        states: { 
                            'stateProperty1': {
                            },
                            'stateProperty11': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty11': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by interface to all states should result in seeing all types of states from all resources that are registered of that interface', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        states: { 
                            '+': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty11': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty2': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3
                        },
                        'stateProperty22': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3
                        },
                        'stateProperty4': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3
                        },
                        'stateProperty44': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            // byType
            it('subscribing by resource type to a specific state should result in seeing that state from all resources that are registered of that resource type', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: 'ResourceType4',
                        states: { 
                            'stateProperty4': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty4': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by resource type to a set of states should result in seeing all those types of states from all resources that are registered of that resource type', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: 'ResourceType4',
                        states: { 
                            'stateProperty1': {
                            },
                            'stateProperty11': {
                            },
                            'stateProperty44': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty11': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty44': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by resource type to all states should result in seeing all types of states from all resources that are registered of that resource type', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: 'ResourceType4',
                        states: { 
                            '+': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty11': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty4': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty44': {
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to a specific type of state on all resource types should result in receiving that type of states from all resources that emit it', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: '+',
                        states: { 
                            'stateProperty4': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to a set of of states on all resource types should result in receiving those types of states from all resources that emit them', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: '+',
                        states: { 
                            'stateProperty4': {
                            },
                            'stateProperty3': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty3': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to all states on all resource types should result in receiving all types of states from all resources', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByType',
                        selection: '+',
                        states: { 
                            '+': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty11': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty2': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'stateProperty22': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'stateProperty3': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'stateProperty33': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'stateProperty4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty44': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            // byID
            it('subscribing by id to a specific state should result in seeing that state from that resource', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: 'myResource1',
                        states: { 
                            'stateProperty2': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty2': {
                            'myResource1': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by id to a set of states should result in seeing all those types of states from that resource', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: 'myResource1',
                        states: { 
                            'stateProperty2': {
                            },
                            'stateProperty1': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3
                        },
                        'stateProperty2': {
                            'myResource1': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by id to all states should result in seeing all types of states from that resource', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: 'myResource1',
                        states: { 
                            '+': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3
                        },
                        'stateProperty11': {
                            'myResource1': 3
                        },
                        'stateProperty2': {
                            'myResource1': 3
                        },
                        'stateProperty22': {
                            'myResource1': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to all ids to a particular state should result in seeing that type of state from all resources', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: '+',
                        states: { 
                            'stateProperty4': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to all ids to a set of states should result in seeing those types of states from all resources', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: '+',
                        states: { 
                            'stateProperty4': {
                            },
                            'stateProperty3': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty3': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to all ids to a all states should result in seeing all states', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByID',
                        selection: '+',
                        states: { 
                            '+': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty11': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty2': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'stateProperty22': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'stateProperty3': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'stateProperty33': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource9': 3,
                            'myResource10': 3,
                            'myResource11': 3,
                            'myResource12': 3,
                        },
                        'stateProperty4': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                        'stateProperty44': {
                            'myResource5': 3,
                            'myResource6': 3,
                            'myResource7': 3,
                            'myResource8': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            // byGroup
            it('subscribing by group to a specific state should result in seeing that state from any resource that emits it in that group or its children', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByGroup',
                        selection: 'A/B/C',
                        states: { 
                            'stateProperty2': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty2': {
                            'myResource1': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by group to a set of states should result in seeing all those types of states from any resource that emits them in that group or its children', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByGroup',
                        selection: 'A/B/C',
                        states: { 
                            'stateProperty2': {
                            },
                            'stateProperty4': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty2': {
                            'myResource1': 3
                        },
                        'stateProperty4': {
                            'myResource5': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing by group to all states should result in seeing all types of states from all resources in that group or its children', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByGroup',
                        selection: 'A/B/C',
                        states: { 
                            '+': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3
                        },
                        'stateProperty11': {
                            'myResource1': 3
                        },
                        'stateProperty2': {
                            'myResource1': 3
                        },
                        'stateProperty22': {
                            'myResource1': 3
                        },
                        'stateProperty3': {
                            'myResource5': 3
                        },
                        'stateProperty33': {
                            'myResource5': 3
                        },
                        'stateProperty4': {
                            'myResource5': 3
                        },
                        'stateProperty44': {
                            'myResource5': 3
                        }
                    },
                    listenTime: 8000
                });
            });

            it('subscribing to state in an empty-string location name is the root group', function() {
                this.timeout(60000);
                return doStateSubscriptionTest({
                    subscribeSet: {
                        selectionType: 'selectByGroup',
                        selection: '+', // TODO this doesn't make a lot of sense
                        states: { 
                            'stateProperty1': {
                            }
                        }
                    },
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource13': 3,
                            'myResource14': 3
                        }
                    },
                    listenTime: 8000
                });
            });
        });

        describe('#unsubscribeFromState', function() {
            function doStateUnsubscribeTest(testConfiguration) {
                var subscribeSet = testConfiguration.subscribeSet;
                var unsubscribeSet = testConfiguration.unsubscribeSet;
                var stateSet = testConfiguration.stateSet;
                var listenTime = testConfiguration.listenTime;
                var resourceClient = newDJSClient();
                var listenClient = newDJSClient();
                var sendEventIntervals = [ ];

                return resourceClient.connect().then(function() {
                    return listenClient.connect();
                }).then(function() {
                    return Promise.all(Object.keys(interfaceTypes).map(function(k) {
                        //console.log('Add interface type', k, interfaceTypes[k]);
                        return resourceClient.addInterfaceType(interfaceTypes[k]);
                    }));
                }).then(function() {
                    return Promise.all(Object.keys(resourceTypes).map(function(k) {
                        //console.log('Add resource type', k);
                        return resourceClient.addResourceType(resourceTypes[k]);
                    }));
                }).then(function() {
                    var id = 0;

                    // Register 4 of each type of resource
                    // Start emitting states for these all of these resources
                    // every two seconds
                    return Promise.all(Object.keys(resourceTypes).map(function(resourceType) { 
                        var interfaces = resourceTypes[resourceType].interfaces;
                        var states = [ ];

                        interfaces.forEach(function(interfaceName) {
                            states.push.apply(states, Object.keys(interfaceTypes[interfaceName].state));
                        });

                        return Promise.all([++id, ++id, ++id, ++id].map(function(id) {
                            return resourceClient.registerResource('myResource' + id, resourceType).then(function() {
                                // for each registered resource, it should emit all types of states that it can emit every
                                // two seconds
                                sendEventIntervals.push(setInterval(function() {
                                    states.forEach(function(state) {
                                        resourceClient.publishResourceStateChange('myResource' + id, state, ''+Math.random());
                                    });
                                }, 2000));
                            });
                        }))
                    })).then(function() {
                        return resourceClient.joinResourceGroup('myResource1', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource5', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource9', 'A/B');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource13', 'A');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource2', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource10', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource6', 'X/Y');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource14', 'X');
                    }).then(function() {
                    }).then(function() {
                    });
                }).then(function() {
                    var selection = listenClient[subscribeSet.selectionType].call(listenClient, subscribeSet.selection);
                    var seenFrom = { };

                    return Promise.all(Object.keys(subscribeSet.states).map(function(stateName) {
                        //console.log(subscribeSet.selectionType, subscribeSet.selection, 'subscribing to', stateName);
                        return selection.subscribeToState(stateName);
                    })).then(function(results) {
                        return Promise.all(unsubscribeSet.map(function(index) {
                            //console.log(unsubscribeSet.selectionType, unsubscribeSet.selection, 'unsubscribing from', stateName);
                            //return unsubscribeSelection.unsubscribeFromState(stateName);
                            return selection.unsubscribe(results[index].id);
                        }));
                    }).then(function() {
                        selection.on('state', function(resourceID, stateName, stateData) {
                            //console.log('Saw', resourceID, stateName, stateData);
                            seenFrom[stateName] = seenFrom[stateName] || { };
                            seenFrom[stateName][resourceID] = seenFrom[stateName][resourceID] || 0;
                            seenFrom[stateName][resourceID] += 1;
                        });

                        return new Promise(function(resolve, reject) {
                            setTimeout(function() {
                                resolve();
                            }, listenTime)
                        });
                    }).then(function() {
                        // the same number of types of states were seen as expected
                        //console.log('SEEN FROM', seenFrom);
                        //console.log('EXPECTED', stateSet);
                        Object.keys(seenFrom).length.should.be.eql(Object.keys(stateSet).length);

                        // make sure that the state types that we saw are all expected state types
                        Object.keys(seenFrom).forEach(function(stateName) {
                            stateSet.should.have.ownProperty(stateName);

                            // make sure that we received the state type from the expected number of resources
                            Object.keys(seenFrom[stateName]).length.should.be.eql(Object.keys(stateSet[stateName]).length);

                            // make sure that the set of resources that we received this state from is correct
                            // and that we received each state from each resource the expected number of times
                            Object.keys(seenFrom[stateName]).forEach(function(resourceID) {
                                var seenStateCount = seenFrom[stateName][resourceID];
                                var expectedStateCount = stateSet[stateName][resourceID];

                                //console.log('Seen from', stateName, resourceID, seenStateCount);
                                //console.log('Expected from', stateName, resourceID, expectedStateCount);
                                seenStateCount.should.be.approximately(expectedStateCount, 1);
                            });
                        });
                    });
                }).then(function() {
                    sendEventIntervals.forEach(function(i) {
                        clearInterval(i);
                    });
                    return resourceClient.disconnect();
                }).then(function() {
                    return listenClient.disconnect();
                });
            }

            it('unsubscribing from a particular state should prevent seeing any of that type of state', function() {
                this.timeout(60000);
                return doStateUnsubscribeTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        states: { 
                            'stateProperty1': {
                            },
                            'stateProperty11': {
                            }
                        }
                    },
                    unsubscribeSet: [ 1 ],
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        }
                    },
                    listenTime: 8000
                });
            });

            it('unsubscribing from states wildcard results in no states seen if subscribed to wildcard', function() {
                this.timeout(60000);
                return doStateUnsubscribeTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        states: { 
                            '+': {
                            }
                        }
                    },
                    unsubscribeSet: [ 0 ],
                    stateSet: {
                    },
                    listenTime: 8000
                });
            });

            it('unsubscribing from states wildcard should not affect subscriptions to specific topics', function() {
                this.timeout(60000);
                return doStateUnsubscribeTest({
                    subscribeSet: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1',
                        states: { 
                            '+': {
                            },
                            'stateProperty1': {
                            }
                        }
                    },
                    unsubscribeSet: [ 0 ],
                    stateSet: {
                        'stateProperty1': {
                            'myResource1': 3,
                            'myResource2': 3,
                            'myResource3': 3,
                            'myResource4': 3,
                            'myResource13': 3,
                            'myResource14': 3,
                            'myResource15': 3,
                            'myResource16': 3,
                        },
                    },
                    listenTime: 8000
                });
            });
        });

        describe('#listResources', function() {
            function doListResourcesTest(testConfiguration) {
                var selection = testConfiguration.selection;
                var expectedResult = testConfiguration.expectedResult;
                var resourceClient = newDJSClient();
                var listClient = newDJSClient();

                return resourceClient.connect().then(function() {
                    return listClient.connect();
                }).then(function() {
                    return Promise.all(Object.keys(interfaceTypes).map(function(k) {
                        //console.log('Add interface type', k, interfaceTypes[k]);
                        return resourceClient.addInterfaceType(interfaceTypes[k]);
                    }));
                }).then(function() {
                    return Promise.all(Object.keys(resourceTypes).map(function(k) {
                        //console.log('Add resource type', k);
                        return resourceClient.addResourceType(resourceTypes[k]);
                    }));
                }).then(function() {
                    var id = 0;

                    // Register 4 of each type of resource
                    // Start emitting states for these all of these resources
                    // every two seconds
                    return Promise.all(Object.keys(resourceTypes).map(function(resourceType) { 
                        var interfaces = resourceTypes[resourceType].interfaces;
                        var states = [ ];

                        interfaces.forEach(function(interfaceName) {
                            states.push.apply(states, Object.keys(interfaceTypes[interfaceName].state));
                        });

                        return Promise.all([++id, ++id, ++id, ++id].map(function(id) {
                            return resourceClient.registerResource('myResource' + id, resourceType);
                        }))
                    })).then(function() {
                        return resourceClient.joinResourceGroup('myResource1', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource5', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource9', 'A/B');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource13', 'A');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource2', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource10', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource6', 'X/Y');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource14', 'X');
                    }).then(function() {
                    }).then(function() {
                    });
                }).then(function() {
                    var sel = listClient[selection.selectionType].call(listClient, selection.selection);

                    return sel.listResources();
                }).then(function(resourceList) {
                    resourceList.should.be.eql(expectedResult);
                }).then(function() {
                    return resourceClient.disconnect();
                }).then(function() {
                    return listClient.disconnect();
                });
            }

            it('listing by interface should return only resources that implement that interface', function() {
                return doListResourcesTest({
                    selection: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource15': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource16': { reachable: true, registered: true, type: 'ResourceType4' },
                    }
                });
            });

            it('listing by interface wildcard should return all resources', function() {
                return doListResourcesTest({
                    selection: {
                        selectionType: 'selectByInterface',
                        selection: '+'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource6': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource7': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource8': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource10': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource11': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource12': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource15': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource16': { reachable: true, registered: true, type: 'ResourceType4' },
                    }
                });
            });

            it('listing by type should return only resources of that type', function() {
                return doListResourcesTest({
                    selection: {
                        selectionType: 'selectByType',
                        selection: 'ResourceType1'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                    }
                });
            });

            it('listing by type wildcard should return all resources', function() {
                return doListResourcesTest({
                    selection: {
                        selectionType: 'selectByType',
                        selection: '+'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource6': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource7': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource8': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource10': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource11': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource12': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource15': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource16': { reachable: true, registered: true, type: 'ResourceType4' },
                    }
                });
            });

            it('listing by id should return only that resource', function() {
                return doListResourcesTest({
                    selection: {
                        selectionType: 'selectByID',
                        selection: 'myResource1'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                    }
                });
            });

            it('listing by id wildcard should return all resources', function() {
                return doListResourcesTest({
                    selection: {
                        selectionType: 'selectByID',
                        selection: '+'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource6': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource7': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource8': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource10': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource11': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource12': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource15': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource16': { reachable: true, registered: true, type: 'ResourceType4' },
                    }
                });
            });

            it('listing by specific group returns all resources contained in that group and its children', function() {
                return doListResourcesTest({
                    selection: {
                        selectionType: 'selectByGroup',
                        selection: 'A'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                    }
                });
            });

            it('listing by wildcard group returns all resources contained in all groups', function() {
                return doListResourcesTest({
                    selection: {
                        selectionType: 'selectByGroup',
                        selection: '+'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource10': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource6': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                    }
                });
            });
        });

        describe('#discover', function() {
            function doDiscoverResourcesTest(testConfiguration) {
                var selection = testConfiguration.selection;
                var expectedResult = testConfiguration.expectedResult;
                var listenTime = testConfiguration.listenTime;
                var resourceClient = newDJSClient();
                var listClient = newDJSClient();
                var sel = listClient[selection.selectionType].call(listClient, selection.selection);
                var resourceList = { };
                
                return resourceClient.connect().then(function() {
                    return listClient.connect();
                }).then(function() {
                    return Promise.all(Object.keys(interfaceTypes).map(function(k) {
                        //console.log('Add interface type', k, interfaceTypes[k]);
                        return resourceClient.addInterfaceType(interfaceTypes[k]);
                    }));
                }).then(function() {
                    return Promise.all(Object.keys(resourceTypes).map(function(k) {
                        //console.log('Add resource type', k);
                        return resourceClient.addResourceType(resourceTypes[k]);
                    }));
                }).then(function() {
                    sel.on('discover', function(resourceID, resourceInfo) {
                        resourceList[resourceID] = resourceInfo;
                    });
                    
                    return sel.discover()
                }).then(function() {
                    var id = 0;

                    // Register 4 of each type of resource
                    // Start emitting states for these all of these resources
                    // every two seconds
                    return Promise.all(Object.keys(resourceTypes).map(function(resourceType) { 
                        var interfaces = resourceTypes[resourceType].interfaces;
                        var states = [ ];

                        interfaces.forEach(function(interfaceName) {
                            states.push.apply(states, Object.keys(interfaceTypes[interfaceName].state));
                        });

                        return Promise.all([++id, ++id, ++id, ++id].map(function(id) {
                            return resourceClient.registerResource('myResource' + id, resourceType);
                        }))
                    })).then(function() {
                        return resourceClient.joinResourceGroup('myResource1', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource5', 'A/B/C');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource9', 'A/B');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource13', 'A');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource2', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource10', 'X/Y/Z');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource6', 'X/Y');
                    }).then(function() {
                        return resourceClient.joinResourceGroup('myResource14', 'X');
                    }).then(function() {
                    }).then(function() {
                    });
                }).then(function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() {
                            resolve(resourceList);
                        }, listenTime);
                    });
                }).then(function(resourceList) {
                    resourceList.should.be.eql(expectedResult);
                }).then(function() {
                    return resourceClient.disconnect();
                }).then(function() {
                    return listClient.disconnect();
                });
            }

            it('discovering by interface should return only resources that implement that interface', function() {
                this.timeout(60000);
                return doDiscoverResourcesTest({
                    selection: {
                        selectionType: 'selectByInterface',
                        selection: 'InterfaceType1'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource15': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource16': { reachable: true, registered: true, type: 'ResourceType4' },
                    },
                    listenTime: 8000
                });
            });

            it('discovering by interface wildcard should return all resources', function() {
                this.timeout(60000);
                return doDiscoverResourcesTest({
                    selection: {
                        selectionType: 'selectByInterface',
                        selection: '+'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource6': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource7': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource8': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource10': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource11': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource12': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource15': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource16': { reachable: true, registered: true, type: 'ResourceType4' },
                    },
                    listenTime: 8000
                });
            });

            it('discovering by type should return only resources of that type', function() {
                this.timeout(60000);
                return doDiscoverResourcesTest({
                    selection: {
                        selectionType: 'selectByType',
                        selection: 'ResourceType1'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                    },
                    listenTime: 8000
                });
            });

            it('discovering by type wildcard should return all resources', function() {
                this.timeout(60000);
                return doDiscoverResourcesTest({
                    selection: {
                        selectionType: 'selectByType',
                        selection: '+'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource6': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource7': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource8': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource10': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource11': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource12': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource15': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource16': { reachable: true, registered: true, type: 'ResourceType4' },
                    },
                    listenTime: 8000
                });
            });

            it('discovering by id should return only that resource', function() {
                this.timeout(60000);
                return doDiscoverResourcesTest({
                    selection: {
                        selectionType: 'selectByID',
                        selection: 'myResource1'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                    },
                    listenTime: 8000
                });
            });

            it('discovering by id wildcard should return all resources', function() {
                this.timeout(60000);
                return doDiscoverResourcesTest({
                    selection: {
                        selectionType: 'selectByID',
                        selection: '+'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource3': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource4': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource6': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource7': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource8': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource10': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource11': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource12': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource15': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource16': { reachable: true, registered: true, type: 'ResourceType4' },
                    },
                    listenTime: 8000
                });
            });

            it('discovering by specific group returns all resources contained in that group and its children', function() {
                this.timeout(60000);
                return doDiscoverResourcesTest({
                    selection: {
                        selectionType: 'selectByGroup',
                        selection: 'A'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                    },
                    listenTime: 8000
                });
            });

            it('discovering by wildcard group returns all resources contained in all groups', function() {
                this.timeout(60000);
                return doDiscoverResourcesTest({
                    selection: {
                        selectionType: 'selectByGroup',
                        selection: '+'
                    },
                    expectedResult: { 
                        'myResource1': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource9': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource5': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource13': { reachable: true, registered: true, type: 'ResourceType4' },
                        'myResource2': { reachable: true, registered: true, type: 'ResourceType1' },
                        'myResource10': { reachable: true, registered: true, type: 'ResourceType3' },
                        'myResource6': { reachable: true, registered: true, type: 'ResourceType2' },
                        'myResource14': { reachable: true, registered: true, type: 'ResourceType4' },
                    },
                    listenTime: 8000
                });
            });
        });

        /*describe('#stopDiscovering', function() {
            it('', function() {
                return Promise.reject();
            });
        });*/

        /*describe('#call', function() {
            it('asdf', function() {
                return Promise.reject();
            });
        });

        describe('#set', function() {
            it('asdf', function() {
                return Promise.reject();
            });
        });

        describe('#get', function() {
            it('asdf', function() {
                return Promise.reject();
            });
        });*/
    });

    describe('ResourceController', function() {
    });
});
