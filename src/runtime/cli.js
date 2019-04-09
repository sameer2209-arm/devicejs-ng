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

// DEVICEJS MODULE COMMANDS
// devicejs modules status -- lists conents of file modified by the add/remove commands
// devicejs modules enable [MODULE NAME] -- calls enable on the given module to load it into the devicejs system
// devicejs modules disable [MODULE NAME] -- calls disable on the given module and unloads it from the devicejs system
//
// devicejs start --port 8080 --config ./config.json
// devicejs stop --port 8080
// devicejs run script.js --serverAddress 127.0.0.1 --serverPort 8080

var path = require('path');
var USAGE_MESSAGE = 
'Usage: devicejs <command> [<args>]\n' +
'\n' +
'Command types are:\n' +
'  modules     install, uninstall, enable, disable and see the status of installed modules\n' +
'  start       start a devicejs server\n' +
'  stop        stop a devicejs server\n' +
'  run         run a devicejs script\n' +
'  shell       run a devicejs interactive shell\n';

var moduleCommand = function(handler, command, moduleSpecifier) {
	var cp = require('child_process');
	
	// START THE DAEMON
	var daemon = cp.fork(__dirname + '/modules.js', process.argv.slice(3));
};

var startCommand = function(handler, command) {
	var cp = require('child_process');
	
	// START THE DAEMON
    process.argv.splice(2, 1)
    require(__dirname + '/start.js')
};

var stopCommand = function(handler, command) {
	var cp = require('child_process');
	
	// START THE DAEMON
	var daemon = cp.fork(__dirname + '/stop.js', process.argv.slice(3));
};

var runCommand = function(handler, command) {
	var cp = require('child_process');
	
	// START THE DAEMON
    process.argv.splice(2, 1)
    require(__dirname + '/run.js')
};

var shellCommand = function(handler, command) {
	var cp = require('child_process');

    process.argv.splice(2, 1, __dirname + '/shell.js')
    require(__dirname + '/run.js')
};

var commands = {
	'modules': moduleCommand,
	'start': startCommand,
	'stop': stopCommand,
	'run': runCommand,
	'shell': shellCommand
};

var run = function(handler) {
	var command = commands[handler];
	
	if(typeof command !== 'function') {
		console.error(USAGE_MESSAGE);
	}
	else {
		command.apply(this, arguments);
	}
};

run.apply(this, process.argv.slice(2));
