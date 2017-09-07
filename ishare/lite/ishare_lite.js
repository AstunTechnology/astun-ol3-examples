'use strict';

var ol = require('openlayers');
// TODO Create custom smaller proj4 build? See http://proj4js.org/
var proj4 = require('proj4');
ol.proj.setProj4(proj4);

var Popup = require('ol-popup');

var parallel = require('run-parallel');

var iShare = (function () {

    var LiteMap = function (options) {

        ol.Object.call(this);

        this.type = 'LITE';

        options.layers = options.layers.split(',');

        // TODO create map, add plugins etc. then call loadProfile method which
        // gets the profile, **clears any existing layers**, adds new layers etc?

        this.map = LiteMap.createMap(options.target);

        // Currently active plugins
        this.plugins = [];

        var plugins = (options.plugins) ? options.plugins : LiteMap.defaultPlugins();
        for (var m = 0, plugin; m < plugins.length; m++) {
            plugin = plugins[m];
            this.addPlugin(plugin);
        }

        // TODO make loading a profile optional to allow users to create a
        // litemap then use loadProfile to load a custom profile
        LiteMap.getProfile(options.iShareUrl, options.profile, function (err, profile) {

            // If we've been passed options.view use it otherwise fallback to
            // the initialView
            profile.view = options.view || profile.initialView;

            // Ensure all layers passed in options are set as initiallyVisible
            LiteMap.profile.getLayerConfigs(profile.layerGroups).forEach(function (l) {
                if (options.layers.indexOf(l.layerName) !== -1) {
                    l.initiallyVisible = true;
                }
            });

            this.loadProfile(profile);

            this.dispatchEvent({'type': 'load'});

        }.bind(this));

        return this;

    };

    ol.inherits(LiteMap, ol.Object);

    // TODO Add options such as createAllLayers:Boolean
    LiteMap.prototype.loadProfile = function (profile) {

        this.profile = profile;

        var baseMaps = profile.baseMaps.map(function (baseMapDef) {
            return new ol.layer.Tile({
                'title': baseMapDef.displayName,
                'type': 'base',
                'visible': profile.defaultBaseMap === baseMapDef.mapName,
                'source': new ol.source.TileWMS({
                    url: baseMapDef.url,
                    attributions: [
                        new ol.Attribution({html: profile.attribution})
                    ],
                    params: {
                        'LAYERS': baseMapDef.layers.join(','),
                        'FORMAT': baseMapDef.format
                    },
                    tileGrid: new ol.tilegrid.TileGrid({
                        origin: profile.extent.slice(0, 2),
                        resolutions: profile.resolutions
                    })
                })
            });
        });

        var baseMapGroup = new ol.layer.Group({
            'iShare:guid': 'basemaps',
            'iShare:config': {},
            'title': 'Base maps',
            'layers': baseMaps
        });

        this.map.addLayer(baseMapGroup);

        var proj = profile.projection;
        proj4.defs(proj.SRS + ':' + proj.SRID, proj.definition);
        var projection = ol.proj.get('EPSG:27700');
        var view = new ol.View({
            projection: projection,
            resolutions: profile.resolutions,
            center: [profile.view.easting, profile.view.northing],
            zoom: nearestZoom(profile.view.zoom, this.map.getSize()[0], profile.resolutions)
        });
        this.map.setView(view);

        // TODO Remove any existing layers

        // TODO If createAllLayers:Boolean === true create an OpenLayers layer
        // for all layers even if they are not visible

        // Loop through each group in profile if the group contains a
        // visible layer, create it, add it to the map then create the
        // visible layer(s) and add those to the group
        for (var m = 0, g; m < profile.layerGroups.length; m++) {
            g = profile.layerGroups[m];
            for (var n = 0, l; n < g.layers.length; n++) {
                l = g.layers[n];
                if (l.initiallyVisible) {
                    // Find the existing group or create and add it to the map
                    var group = LiteMap.ol.getGroupByGuid(this.map.getLayerGroup(), g.guid);
                    if (!group) {
                         group = LiteMap.createGroup(this.profile, g.guid);
                        this.map.addLayer(group);
                    }
                    // Create the layer and add it to the group
                    var layer = LiteMap.createOverlay(this.profile, l.layerName);
                    group.getLayers().push(layer);
                }
            }
        }

        this.dispatchEvent({'type': 'profileload'});

    };

    LiteMap.prototype.addPlugin = function (plugin) {
        plugin.setApp(this);
        this.plugins.push(plugin);
        this.dispatchEvent({'type': 'pluginadd', plugin: plugin});
        return plugin;
    };

    LiteMap.prototype.removePlugin = function (plugin) {
        var index = this.plugins.indexOf(plugin);
        if (index > -1) {
            plugin.setApp(null);
            this.plugins.splice(index, 1);
            this.dispatchEvent({'type': 'pluginremove', plugin: plugin});
        }
        return plugin;
    };

    LiteMap.defaultPlugins = function () {
        return [new InfoPopup()];
    };

    /**
     * Get Profile definition
     * The callback has signiture function (err, profile)
     */
    LiteMap.getProfile = function (iShareUrl, profileName, callback) {

        /**
         * Returns a MapSource URL
         */
        function getProfileUrl (profileName) {
            return iShareUrl + 'getdata.aspx?&type=MapSource&RequestType=JSON&ms=' + profileName;
        }

        /**
         * Returns a function that will request profile config from the server
         */
        function profileRequest (type, profileName) {
            return function (callback) {
                http.getJson(getProfileUrl(profileName), function (err, profile, xhr) {
                    // Ignore any HTTP errors, let the downstream code decide
                    // what to do about missing profiles
                    callback(null, {'type': type, 'mapName': profileName, 'profile': profile});
                });
            };
        }

        var requests = {
            'root': profileRequest('root', 'root'),
            'profile': profileRequest('profile', profileName)
        };

        parallel(requests, function (err, results) {

            // err will always be null as the function returned by
            // profileRequest ignores HTTP errors

            var rootProfile = results['root'].profile;
            var profileDef = results['profile'].profile;

            var requests = [];

            requests = requests.concat(rootProfile.baseMapSources.filter(function (baseMapDef) {
                return profileDef.baseMaps.indexOf(baseMapDef.mapName) > -1;
            }).map(function (profile) {
                return profileRequest('basemap', profile.mapName);
            }));

            parallel(requests, function (err, results) {

                var baseMapDefs = results.map(function (result) {
                    var baseMapDef = result.profile;
                    return {
                        mapName: result.mapName,
                        displayName: rootProfile.baseMapSources.find(function (ms) {
                            return ms.mapName === result.mapName;
                        }).displayName,
                        url: baseMapDef.baseMapDefinition.uri[0],
                        layers: [baseMapDef.baseMapDefinition.name],
                        format: baseMapDef.baseMapDefinition.options.format,
                        resolutions: baseMapDef.baseMapDefinition.scales.map(scaleToResolution),
                        attribution: baseMapDef.baseMapDefinition.copyright
                    };
                });

                var baseMapDef = baseMapDefs.find(function (profile) {
                    return profile.mapName === profileDef.defaultBaseMap;
                });

                var layerGroups = profileDef.layerGroups.map(function (group) {
                    group.layers = group.layers.map(function (layer) {
                        return {
                            'layerName': layer.layerName,
                            'displayName': layer.displayName,
                            'initiallyVisible': layer.initiallyVisible,
                            'infoClick': Boolean(layer.infoClick),
                            'query': layer.query,
                            'searchField': layer.searchField,
                            'type': layer.type,
                            'fields': layer.fields,
                            'thematic': layer.thematic,
                            'ows': layer.ows,
                            'metadata': layer.metadata
                        };
                    });
                    return group;
                });

                var profile = {
                    defaultProfile: rootProfile.defaultMapSource,
                    defaultBaseMap: profileDef.defaultBaseMap,
                    profiles: rootProfile.mapSources,
                    baseMaps: baseMapDefs,
                    extent: profileDef.bounds,
                    projection: profileDef.projection,
                    initialView: profileDef.initialView,
                    units: profileDef.units,
                    resolutions: baseMapDef.resolutions,
                    attribution: baseMapDef.attribution,
                    layerGroups: layerGroups,
                    overlays: {
                        wmsUrl: iShareUrl + 'getows.ashx?mapsource=' + profileName
                    }
                };

                callback(null, profile);

            });

        });

    };

    LiteMap.profile = {
        getLayerConfigs: function (layerGroups) {
            /**
            * Returns a flattened list of all layers found in layerGroups
            */
            var layerConfigs = [];
            for (var m = 0, g; m < layerGroups.length; m++) {
                g = layerGroups[m];
                for (var n = 0, l; n < g.layers.length; n++) {
                    l = g.layers[n];
                    layerConfigs.push(l);
                }
            }
            return layerConfigs;
        },
        getLayerConfig: function (layerGroups, layerName) {
            /**
            * Returns the layer definition with layerName or null if not found
            */
            try {
                return LiteMap.profile.getLayerConfigs(layerGroups).filter(function (layerConfig) {
                    return layerConfig.layerName === layerName;
                })[0];
            } catch (e) {
                return null;
            }
        },
        getGroupConfig: function (layerGroups, guid) {
            /**
            * Return the group definition with the given guid
            */
            try {
                return layerGroups.filter(function (groupConfig) {
                    return groupConfig.guid === guid;
                })[0];
            } catch (e) {
                return null;
            }
        }
    };

    LiteMap.info = {
        applyInfoTemplates: function (infoLayers, featureCollections) {
            var html = featureCollections.map(function (collection, index) {
                // Get a reference to the layer based on the index of the
                // response in the results Array
                var layer = infoLayers[index];
                var layerConfig = layer.get('iShare:config');
                var html = '';
                if (layerConfig.infoClick) {
                    var collectionHtml = collection.map(function (feature) {
                        var html = '<div class="infoResult">';
                        html += layerConfig.fields.map(function (field) {
                            return '<p><strong>' + field.displayName + '</strong> <span>' + feature.get(field.name) + '</span> </p>';
                        }).join('\n');
                        html += '</div>';
                        return html;
                    }).join('\n');
                    if (collectionHtml.length) {
                        html = '<div class="contentDisplay"><h3>' + layerConfig.displayName + '</h3>';
                        html += collectionHtml;
                        html += '</div>';
                    }
                }
                return html;
            }).join('\n');
            return html;
        },
        getInfoAtPoint: function (map, infoLayers, coordinate, callback) {

            function infoRequest (map, layer, coordinate) {

                return function (callback) {

                    var layerName = layer.get('iShare:layerName');

                    var wmsInfoOpts = {
                        'INFO_FORMAT': 'application/vnd.ogc.gml',
                        'FEATURE_COUNT': 10
                    };
                    // Pick up features within 10 pixels of the click
                    wmsInfoOpts['map.layer[' + layerName + ']'] = 'TOLERANCE+10+TOLERANCEUNITS+PIXELS';

                    var wmsInfoUrl = layer.getSource().getGetFeatureInfoUrl(
                        coordinate,
                        map.getView().getResolution(),
                        map.getView().getProjection(),
                        wmsInfoOpts
                    );

                    http.get(wmsInfoUrl, function (err, gmlText, xhr) {
                        var reader = new ol.format.WMSGetFeatureInfo();
                        var collection = reader.readFeatures(gmlText);
                        callback(null, collection);
                    });

                };

            }

            var requests = infoLayers.map(function (layer) {
                return infoRequest(map, layer, coordinate);
            });

            parallel(requests, function (err, results) {
                callback(err, infoLayers, results);
            });

        },
        getInfoLayers: function (layerGroup) {
            return LiteMap.ol.findLayers(layerGroup, function (layer) {
                var layerConfig = layer.get('iShare:config');
                return layer.getVisible() && layerConfig && layerConfig.infoClick;
            });
        }
    };

    LiteMap.ol = {
        findLayers: function (layerGroup, filterFunc) {
            var layers = [];
            function find (lyrGroup, guid) {
                var ls = lyrGroup.getLayers().getArray();
                for (var n = 0, l; n < ls.length; n++) {
                    l = ls[n];
                    if (filterFunc(l, ls)) {
                        layers.push(l);
                    }
                    if (l.getLayers) {
                        find(l, guid);
                    }
                }
            }
            find(layerGroup);
            return layers;
        },
        getGroupByGuid: function (layerGroup, guid) {
            try {
                return iShare.LiteMap.ol.findLayers(layerGroup, function (lyr) {
                    return lyr.get('iShare:guid') === guid;
                })[0];
            } catch (e) {
                return null;
            }
        }
    };

    LiteMap.createGroup = function (profile, guid) {
        var groupConfig = LiteMap.profile.getGroupConfig(profile.layerGroups, guid);
        var group = new ol.layer.Group({
            'iShare:guid': groupConfig.guid,
            'iShare:config': {},
            'title': groupConfig.displayName
        });
        return group;
    };

    LiteMap.createOverlay = function (profile, layerName) {
        var layerConfig = LiteMap.profile.getLayerConfig(profile.layerGroups, layerName);
        var source = new ol.source.ImageWMS({
            'url': profile.overlays.wmsUrl,
            'params': {
                'LAYERS': layerName
            },
            'extent': profile.extent
        });
        var layer = new ol.layer.Image({
            'source': source,
            'iShare:layerName': layerName,
            'iShare:config': layerConfig,
            'title': layerConfig.displayName
        });
        return layer;
    };

    LiteMap.createMap = function (target) {

        var map = new ol.Map({
            target: target,
            layers: [
            ]
        });

        return map;

    };

    /**
     * Create an OpenLayers map pre-configured with base map, overlays etc.
     * defined in iShare profile (MapSource) and specified options
     */
    function liteMap (options, callback) {

        var lite = new LiteMap(options);

        lite.on('load', function (evt) {
            callback(null, evt.target);
        });

        return lite;

    }

    // -- Utility --

    // Constants used to covert for scale to resoluton and back
    var DOTS_PER_INCH = 72;
    var INCHES_PER_METER = 2.54 / (DOTS_PER_INCH * 100);

    /**
    * Convert a scale value to it's corresponding resolution.
    * Assumes units are in meters and fixed DPI.
    */
    function scaleToResolution (scale) {
        return scale * INCHES_PER_METER;
    }

    /**
    * Convert a resolution value to it's corresponding scale.
    * Assumes units are in meters and fixed DPI.
    */
    function resolutionToScale (res) {
        return res / INCHES_PER_METER;
    }

    /**
    * Find the closest zoom level for a given map width in meters.
    * @param meters Number The width across the map in meters that we are finding a zoom
    * level for.
    * @param pixels Number The current width of the map in pixels.
    * @param resolutions Array An ordered list of resolutions that correspond with
    * the zoom levels for the map.
    */
    function nearestZoom (meters, pixels, resolutions) {
        var items = resolutions.map(function (res, idx) {
            var item = {'res': res, 'zoom': idx, 'meters': res * pixels};
            item.diff = Math.abs(item.meters - meters);
            return item;
        });
        var nearest = items.sort(function (a, b) { return a.diff - b.diff; });
        return nearest[0].zoom;
    }

    // -- Plugins --

    /**
     * Minimal Plugin interface
     */
    function Plugin () {
    }

    Plugin.prototype.setApp = function (lite) {
        this.lite = lite;
    };

    /**
     * InfoPopup plugin
     */
    function InfoPopup () {
        this.popupId = 'iShare:InfoPopup';
        Plugin.call(this);
    }

    InfoPopup.prototype = Object.create(Plugin.prototype);
    InfoPopup.prototype.constructor = InfoPopup;

    InfoPopup.prototype.setApp = function (lite) {

        // Clean up if we're passed a null lite instance
        if (lite === null && this.lite) {
            this.lite.map.un('singleclick', this.onSingleClick);
            var popup = this.lite.map.getOverlayById(this.popupId);
            if (popup) {
                this.lite.map.removeOverlay(popup);
            }
        }

        // Call super class method to store a reference to lite
        Plugin.prototype.setApp.call(this, lite);

        // Set up listeners etc. if we have a lite instance
        if (this.lite) {
            // Remove existing handler if it's already defined
            this.lite.map.un('singleclick', this.onSingleClick);
            this.lite.map.on('singleclick', this.onSingleClick, this);
        }

    };

    InfoPopup.prototype.onSingleClick = function (evt) {

        // Show wait cursor while we are requesting info
        evt.map.getViewport().classList.add('wait');

        function displayInfoResults (err, infoLayers, featureCollections) {

            /* jshint validthis: true */

            // Remove wait cursor
            evt.map.getViewport().classList.remove('wait');

            var popup = evt.map.getOverlayById(this.popupId);
            if (!popup) {
                popup = new Popup({id: this.popupId});
                evt.map.addOverlay(popup);
            }

            var html = LiteMap.info.applyInfoTemplates(infoLayers, featureCollections);
            if (html.trim().length) {
                popup.show(evt.coordinate, html);
            } else {
                popup.hide();
            }

        }

        var infoLayers = LiteMap.info.getInfoLayers(evt.map.getLayerGroup());

        LiteMap.info.getInfoAtPoint(evt.map, infoLayers, evt.coordinate, displayInfoResults.bind(this));

    };

    var http = {
        get: function (url, callback) {
            /**
            * Make a GET HTTP request
            * The callback has signiture function (err, text, xhr)
            */
            /* global XMLHttpRequest */
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onload = function (event) {
                // status will be 0 for file:// urls
                if (!xhr.status || (xhr.status >= 200 && xhr.status < 300)) {
                    var text = xhr.responseText;
                    callback(null, text, xhr);
                } else {
                    var err = new Error('Error making request');
                    err.name = 'RequestError';
                    callback(err, null, xhr);
                }
            };
            xhr.send();
            return xhr;
        },
        getJson: function (url, callback) {
            /**
            * Make a GET HTTP request for a JSON document
            * The callback has signiture function (err, json, xhr)
            */
            return http.get(url, function (err, text, xhr) {
                if (err) {
                    callback(err, null, xhr);
                    return;
                }
                var json = null;
                try {
                    json = JSON.parse(text);
                } catch (e) {
                }
                callback(null, json, xhr);
            });
        }
    };

    return {
        LiteMap: LiteMap,
        liteMap: liteMap,
        plugins: {
            'InfoPopup': InfoPopup
        },
        http: http,
        deps: {
            ol: ol,
            Popup: Popup
        }
    };

})();

module.exports = iShare;

// Polyfils

// https://tc39.github.io/ecma262/#sec-array.prototype.find
if (!Array.prototype.find) {
    Object.defineProperty(Array.prototype, 'find', {
        value: function (predicate) {
            // 1. Let O be ? ToObject(this value).
            if (this == null) {
                throw new TypeError('"this" is null or not defined');
            }

            var o = Object(this);

            // 2. Let len be ? ToLength(? Get(O, "length")).
            var len = o.length >>> 0;

            // 3. If IsCallable(predicate) is false, throw a TypeError exception.
            if (typeof predicate !== 'function') {
                throw new TypeError('predicate must be a function');
            }

            // 4. If thisArg was supplied, let T be thisArg; else let T be undefined.
            var thisArg = arguments[1];

            // 5. Let k be 0.
            var k = 0;

            // 6. Repeat, while k < len
            while (k < len) {
                // a. Let Pk be ! ToString(k).
                // b. Let kValue be ? Get(O, Pk).
                // c. Let testResult be ToBoolean(? Call(predicate, T, « kValue, k, O »)).
                // d. If testResult is true, return kValue.
                var kValue = o[k];
                if (predicate.call(thisArg, kValue, k, o)) {
                    return kValue;
                }
                // e. Increase k by 1.
                k++;
            }

            // 7. Return undefined.
            return undefined;
        }
    });
}
