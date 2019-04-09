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

var repl = require('repl');
var os = require('os');
var vm = require('vm');

repl.start({
    prompt: 'devicejs> ',
    eval: function(code, context, file, cb) {
        var err, result;
        try {
            if(repl.useGlobal) {
                result = vm.runInThisContext(code, file);
            } 
            else {
                result = vm.runInContext(code, context, file);
            }
        } 
        catch(e) {
            err = e;
        }

        if(err && process.domain) {
            process.domain.emit('error', err);
            process.domain.exit();
        }
        else {
            Promise.all([result]).then(function(result) {
                cb(err, result[0]);
            }, function(error) {
                cb(err, error)
            });
        }
    }
}).on('exit', function() {
    process.exit(0);
});
