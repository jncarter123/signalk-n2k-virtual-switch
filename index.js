const PLUGIN_ID = 'signalk-n2k-virtual-switch'
const PLUGIN_NAME = 'NMEA 2000 Virtual Switch'
const numIndicators = 28

module.exports = function(app) {
  var plugin = {};
  var virtualSwitch = {};
  var timer;

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = 'Emulates a NMEA 2000 Virtual Switch';

  plugin.schema = {
    type: "object",
    properties: {
      virtualInstance: {
        type: 'number',
        title: 'Instance # of the Virtual Switch',
        default: 107
      },
      sendRate: {
        type: 'number',
        title: 'Send Rate(seconds)',
        description: 'Switch updates will be sent periodically and on switch change.',
        default: 15
      },
      stateTTL: {
        type: 'number',
        title: 'Time to Live(seconds)',
        description: 'Switch state will be cached for the time to live period. A setting of 0 = unlimited.',
        default: 60
      }
    }
  }

  plugin.start = function(options) {
    pluginOptions = options
    if (typeof virtualSwitch === 'object' && Object.keys(virtualSwitch).length != 28) {
      initializeSwitch()

      timer = setInterval(function() {
        sendState()
      }, pluginOptions.sendRate * 1000)
    }

    n2kCallback = (msg) => {
      try {
        var fields = msg['fields']

        if (msg.pgn == 127502 && fields['Switch Bank Instance'] == pluginOptions.virtualInstance ||
          (msg.pgn == 126208 && fields['Function Code'] == 'Command' &&
            fields['PGN'] == 127501 && fields['list'][0].Value == pluginOptions.virtualInstance)) {

          app.debug('Received a virtual switch control update.')
          app.debug('msg: ' + JSON.stringify(msg))

          handleChange(pgn, fields)
        }
      } catch (e) {
        console.error(e)
      }
    }
    app.on("N2KAnalyzerOut", n2kCallback)
  }

  plugin.registerWithRouter = function(router) {
    router.put("/virtualSwitch", (req, res) => {

      var msg = req.body
      if (typeof msg == 'undefined') {
        app.debug('invalid request: ' + data)
        res.status(400)
        res.send('Invalid Request. Must include object for the 127502 PGN. ex. {"pgn":127502,"fields":{"Switch Bank Instance": X, "SwitchY": "Off||On"}}')
        return
      }

      let pgn = msg.pgn
      let fields = msg['fields']
      handleChange(pgn, fields)

      instance = fields['Switch Bank Instance']
      let key = Object.keys(fields).filter((key) => /Switch\d+/.test(key)).toString()
      res.send('Instance ' + instance + ' ' + key + ' switched ' + (fields[key]? 'on' : 'off'))
    })
  }

  plugin.stop = function() {
    if (n2kCallback) {
      app.removeListener("N2KAnalyzerOut", n2kCallback)
      n2kCallback = undefined
    }

    if (timer) {
      clearInterval(timer)
    }
  }

  function initializeSwitch() {
    for (let i = 0; i < numIndicators; i++) {
      virtualSwitch[`Indicator${i}`] = {
        "state": 2,
        "lastUpdated": Date.now()
      }
    }
  }

  function handleChange(pgn, fields) {
    clearInterval(timer)

    let instance, switchNum, value
    switch (pgn) {
      case 127502:
        instance = fields['Switch Bank Instance']
        let key = Object.keys(fields).filter((key) => /Switch\d+/.test(key)).toString()
        switchNum = key.match(/\d+/g).map(Number)
        value = fields[key]
        break
      case 126208:
        instance = fields['list'][0].Value
        switchNum = fields['list'][1].Parameter
        switchNum--
        value = fields['list'][1].Value
        break
    }

    sendDelta(instance, switchNum, value)

    virtualSwitch[`Indicator${switchNum}`].state = value
    virtualSwitch[`Indicator${switchNum}`].lastUpdated = Date.now()

    sendState()

    timer = setInterval(function() {
      sendState()
    }, pluginOptions.sendRate * 1000)
  }

  function sendState() {
    //send status update 127501
    const pgn = {
      pgn: 127501,
      dst: 255,
      "Instance": pluginOptions.virtualInstance
    }

    let keys = Object.keys(virtualSwitch)
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i]
      if (virtualSwitch[key].state != 2 && (pluginOptions.stateTTL === 0 || Date.now() - virtualSwitch[key].lastUpdated < pluginOptions.stateTTL)) {
        pgn[key] = virtualSwitch[key].state === 1 ? 'On' : 'Off'
      }
    }

    if (Object.keys(pgn).length > 3) {
      app.debug('sending pgn %j', pgn)
      app.emit('nmea2000JsonOut', pgn)
    }
  }

  function sendDelta(instance, indicator, value) {
    let delta = {
      "updates": [{
        "values": [{
          "path": 'electrical.switches.bank.' + instance + '.' + indicator,
          "value": value
        }]
      }]
    }

    app.debug(JSON.stringify(delta))
    app.handleMessage(PLUGIN_ID, delta)
  }
  return plugin;
};
