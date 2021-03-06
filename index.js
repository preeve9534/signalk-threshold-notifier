/*
 * Copyright 2018 Paul Reeve <paul@pdjr.eu>
 * Portions Copyright (2017) Scott Bender (see https://github.com/sbender9/signalk-simple-notifications)
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

const Bacon = require('baconjs')
const Schema = require('./lib/signalk-libschema/Schema.js');
const Log = require('./lib/signalk-liblog/Log.js');
const Delta = require('./lib/signalk-libdelta/Delta.js');

const PLUGIN_ID = "pdjr-skplugin-threshold-notifier";
const PLUGIN_SCHEMA_FILE = __dirname + "/schema.json";
const PLUGIN_UISCHEMA_FILE = __dirname + "/uischema.json";
const NOTIFICATION_PREFIX = "notifications.";

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];

  plugin.id = PLUGIN_ID;
  plugin.name = "Threshold notifier";
  plugin.description = "Issue notifications when a path value goes outside defined limits.";

  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });

  plugin.schema = function() {
    return(Schema.createSchema(PLUGIN_SCHEMA_FILE).getSchema());
  }

  plugin.uiSchema = function() {
    return(Schema.createSchema(PLUGIN_UISCHEMA_FILE).getSchema());
  }

  // Filter out rules which are disabled and map monitored path values into
  // a stream of comparator values where -1 = below low threshold, 1 = above
  // high threshold and 0 = between threshold.  Eliminate duplicate values
  // in this new stream and issue a notification based upon the resulting
  // comparator.  
  //  
  plugin.start = function(options) {
    options.rules = (options.rules || []).filter(rule => rule.enabled);
    log.N("monitoring " + options.rules.length + " path" + ((options.rules.length == 1)?"":"s"));

    unsubscribes = options.rules.reduce((a, { triggerpath, notificationpath, lowthreshold, highthreshold }) => {
      var stream = app.streambundle.getSelfStream(triggerpath)
      a.push(stream.map(value => {
        var retval = 0;
        if (lowthreshold) lowthreshold['actual'] = value;
        if (highthreshold) highthreshold['actual'] = value;
        if ((lowthreshold) && (lowthreshold.value) && (value < lowthreshold.value)) {
          retval = -1;
        } else if ((highthreshold) && (highthreshold.value) && (value > highthreshold.value)) {
          retval = 1;
        }
        return(retval);
      }).skipDuplicates().onValue(test => {
        var nactual = (lowthreshold)?lowthreshold.actual:highthreshold.actual;
        if (test == 0) {
          var noti = app.getSelfPath(notificationpath);
          if (noti != null) {
            //log.N(nactual + " => cancelling '" + noti.value.state + "' notification on '" + npath + "'", false);
            //cancelNotification(npath);
          }
        } else {
          var nstate = (test == -1)?lowthreshold.state:highthreshold.state;
          log.N(nactual + " => issuing '" + nstate + "' notification on '" + notificationpath + "'", false);
          issueNotification(notificationpath, nstate.message, test, lowthreshold, highthreshold);
        }
      }));
      return(a);
    }, []);
  }

  plugin.stop = function() {
    unsubscribes.forEach(f => f())
    unsubscribes = []
  }

  function issueNotification(path, message, test, lowthreshold, highthreshold) {
    var date = (new Date()).toISOString();
    var vessel = app.getSelfPath("name");
    var state = ((test == 1)?highthreshold:lowthreshold).state;
    var method = ((test == 1)?highthreshold:lowthreshold).method;
    var value = ((test == 1)?highthreshold:lowthreshold).actual;
    var threshold = ((test == 1)?highthreshold:lowthreshold).value;
    var comp = (test == 1)?"above":"below";
    var action = (state == "normal")?"stopping":"starting";
    message = (message)?eval("`" + message + "`"):"";
    (new Delta(app, plugin.id)).addValue(path, { message: message, state: state, method: method }).commit().clear();
    return;
  }

  return(plugin);
}
