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

//DEVJS_LOGGER: '{"type":"global","sinkaddress":"/tmp/grease.socket","config":"./default_logger.conf.json"}',
var globallog = null;
if(process.env['DEVJS_LOGGER']) {
    var conf = null;
    try {
        conf = JSON.parse(process.env['DEVJS_LOGGER']);
    } catch(e) {
        console.error("Failed to parse DEVJS_LOGGER env var: ",e);
    }
    if(conf && conf.type=='global' && conf.modulepath) {
        globallog = require(conf.modulepath)({client_only:true});
        module.exports = function() {
            return globallog;
        }
    }
}

if(!globallog) {

    var winston = require('winston');

    module.exports = function (label) {
        var _levels = {
            error: 8,
            warn: 7,
            info: 6,
            success: 5,
            verbose: 4,
            debug: 3,
            debug2: 2,
            debug3: 1,
            trace: 0
        };
        var _colors = {
            log: 'blue',
            warn: 'yellow',
            error: 'red',
            success: 'green',
            info: 'green',
            debug: 'blue',
            debug2: 'blue',
            debug3: 'blue',
            trace: 'blue'
        };

        var logger = new winston.Logger({
            transports: [
                new winston.transports.Console({
                    colorize: true,
                    prettyPrint: true,
                    level: 'info',
                    label: label
                })
            ],
            levels: _levels,
            colors: _colors
        });

        //logger.cli();

        // these are extended options which are supported in the production logger
        // and are used by some of the WW team

        var keyz = Object.keys(_colors);
        for (var n = 0; n < keyz.length; n++) {
            (function (level) {
                logger[level + '_ex'] = function () {
                    if (typeof arguments[0] === 'object') {
                        var str;
                        if (arguments[0].tag) {
                            str = "<" + arguments[0].tag + ">";
                            if (arguments[0].origin)
                                str += " ";
                        } else {
                            str = "";
                        }
                        if (arguments[0].origin)
                            str = str + "[" + arguments[0].origin + "]";
                        arguments[0] = str;
                    }
                    logger[level].apply(logger, arguments);
                };
            })(keyz[n]);
        }

        return logger;
    };
}
