# signalk-n2k-virtual-switch

# Getting started
1.) Use the SignalK Appstore to install the signalk-n2k-virtual-switch plugin.<br/>
2.) Browse to Server => Plugin => NMEA 2000 Virtual Switch and enable it.<br/>
3.) Restart SignalK<br/>

## Configuration
The defaults should work for most situations but you can make changes as needed for your use case.

![Configuration](https://user-images.githubusercontent.com/30420708/77254310-44653400-6c2e-11ea-8ddc-1df61b83b87b.png)

# API
An API is provided for use by external systems. 

PUT to http://{{skserver}}/plugins/signalk-n2k-virtual-switch/virtualSwitch

The body should be a JSON object that follows the Canboat JSON for PGN 127502. The Switch Bank Instance should be the same as the
plugin is configured. The Switch0 should be "Switch" followed by the switch number from 1-28.
```JSON
{
    "pgn": 127502,
    "fields": {
        "Switch Bank Instance": 107,
        "Switch0": 1
    }
}
```
