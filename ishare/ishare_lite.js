"use strict";

var iShare = (function () {

    var LiteMap = function(options) {

        ol.Object.call(this);

        this.type = "LITE";

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
        LiteMap.getProfile(options.iShareUrl, options.profile, function(err, profile) {
            console.log(profile);

            // If we've been passed options.view use it otherwise fallback to
            // the initialView
            profile.view = options.view || profile.initialView;

            // Ensure all layers passed in options are set as initiallyVisible
            LiteMap.profile.getLayerConfigs(profile.layerGroups).forEach(function(l) {
                if (options.layers.indexOf(l.layerName) != -1) {
                    l.initiallyVisible = true;
                }
            });

            this.loadProfile(profile);

            this.dispatchEvent({"type": "load"});

        }.bind(this));

        return this;

    };

    ol.inherits(LiteMap, ol.Object);

    // TODO Add options such as createAllLayers:Boolean
    LiteMap.prototype.loadProfile = function(profile) {

        this.profile = profile;

        // TODO Add a base map group and add a layer for each base map

        var baseMaps = profile.baseMaps.map(function(baseMapDef) {
            return new ol.layer.Tile({
                "title": baseMapDef.displayName,
                "type": "base",
                "visible": profile.defaultBaseMap === baseMapDef.mapName,
                "source": new ol.source.TileWMS({
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

        this.dispatchEvent({"type": "profileload"});

    };

    LiteMap.prototype.addPlugin = function(plugin) {
        plugin.setApp(this);
        this.plugins.push(plugin);
        this.dispatchEvent({"type": "pluginadd", plugin: plugin});
        return plugin;
    };

    LiteMap.prototype.removePlugin = function(plugin) {
        var index = this.plugins.indexOf(plugin);
        if (index > -1) {
            plugin.setApp(null);
            this.plugins.splice(index, 1);
            this.dispatchEvent({"type": "pluginremove", plugin: plugin});
        }
        return plugin;
    };

    LiteMap.defaultPlugins = function() {
        return [new InfoPopup()];
    };

    LiteMap.getProfile = function(iShareUrl, profileName, callback) {

        var rootUrl = iShareUrl + "getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=root";

        // Request root and named profile together then request only those base maps used by named profile

        reqwest({
            url: rootUrl,
            type: 'jsonp'
        }).then(function (rootProfile) {
            // console.log(JSON.stringify(rootProfile));

            var requests = [];

            requests = requests.concat(rootProfile.mapSources.map(function(profile) {
                return {
                    "type": "profile",
                    "mapName": profile.mapName,
                    "url": iShareUrl + "getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=" + profile.mapName
                };
            }));

            requests = requests.concat(rootProfile.baseMapSources.map(function(profile) {
                return {
                    "type": "basemap",
                    "mapName": profile.mapName,
                    "url": iShareUrl + "getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=" + profile.mapName
                };
            }));
            // console.log(requests);

            var results = Array(requests.length);
            requests.forEach(function(request, index) {
                reqwest({
                    url: request.url,
                    type: 'jsonp'
                }).then(function (profile) {

                    results[index] = {"type": requests[index].type, "mapName": requests[index].mapName, "profile": profile};

                    for (var i = 0; i < results.length; i++) {
                        if (results[i] == null) {
                            // If we find that one of the results is missing
                            // simply return and wait until all requests are
                            // complete and the results Array is full
                            return;
                        }
                    }
                    // console.log(results);

                    // All results are in...
                    var profiles = results.map(function(result) {
                        result.profile.mapName = result.mapName;
                        result.profile.type = result.type;
                        return result.profile;
                    });
                    console.log(profiles);

                    var profileDef = profiles.find(function(profile) {
                        return profile.mapName === profileName;
                    });
                    console.log(profileDef);

                    var baseMapDef = profiles.find(function(profile) {
                        return profile.mapName === profileDef.defaultBaseMap;
                    });

                    var layerGroups = profileDef.layerGroups.map(function(group) {
                        group.layers = group.layers.map(function(layer) {
                            return {
                                "layerName": layer.layerName,
                                "displayName": layer.displayName,
                                "initiallyVisible": layer.initiallyVisible,
                                "infoClick": Boolean(layer.infoClick),
                                "query": layer.query,
                                "searchField": layer.searchField,
                                "type": layer.type,
                                "fields": layer.fields,
                                "thematic": layer.thematic,
                                "ows": layer.ows,
                                "metadata": layer.metadata
                            };
                        });
                        return group;
                    });

                    var baseMaps = profiles.filter(function(profile) {
                        return profile.type === 'basemap' && profileDef.baseMaps.indexOf(profile.mapName) > -1;
                    }).map(function(baseMapDef) {
                        return {
                            mapName: baseMapDef.mapName,
                            displayName: rootProfile.baseMapSources.find(function(ms) {
                                return ms.mapName === baseMapDef.mapName;
                            }).displayName,
                            url: baseMapDef.baseMapDefinition.uri[0],
                            layers: [baseMapDef.baseMapDefinition.name],
                            format: baseMapDef.baseMapDefinition.options.format
                        };
                    });

                    var profile = {
                        defaultProfile: rootProfile.defaultMapSource,
                        defaultBaseMap: profileDef.defaultBaseMap,
                        profiles: rootProfile.mapSources,
                        baseMaps: baseMaps,
                        extent: profileDef.bounds,
                        projection: profileDef.projection,
                        initialView: profileDef.initialView,
                        units: profileDef.units,
                        resolutions: baseMapDef.baseMapDefinition.scales.map(scaleToResolution),
                        attribution: baseMapDef.baseMapDefinition.copyright,
                        layerGroups: layerGroups,
                        overlays: {
                            wmsUrl: iShareUrl + 'getows.ashx?mapsource=' + profileName
                        }
                    };

                    callback(null, profile);


                });

            });

        });

    };

    LiteMap.profile = {
        getLayerConfigs: function(layerGroups) {
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
        getLayerConfig: function(layerGroups, layerName) {
            /**
            * Returns the layer definition with layerName or null if not found
            */
            try {
                return LiteMap.profile.getLayerConfigs(layerGroups).filter(function(layerConfig) {
                    return layerConfig.layerName === layerName;
                })[0];
            } catch (e) {
                return null;
            }
        },
        getGroupConfig: function(layerGroups, guid) {
            /**
            * Return the group definition with the given guid
            */
            try {
                return layerGroups.filter(function(groupConfig) {
                    return groupConfig.guid === guid;
                })[0];
            } catch (e) {
                return null;
            }
        }
    };

    LiteMap.info = {
        applyInfoTemplates: function(infoLayers, featureCollections) {
            var html = featureCollections.map(function(collection, index) {
                // Get a reference to the layer based on the index of the
                // response in the results Array
                var layer = infoLayers[index];
                var layerConfig = layer.get("iShare:config");
                var html = '';
                if (layerConfig.infoClick) {
                    var collectionHtml = collection.map(function(feature) {
                        var html = '<div class="infoResult">';
                        html += layerConfig.fields.map(function(field) {
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
        getInfoAtPoint: function(map, infoLayers, coordinate, callback) {
            // Create an empty Array to store the results of the GetFeatureInfo
            // requests in
            var results = Array(infoLayers.length);

            infoLayers.forEach(function(layer, index) {

                var layerName = layer.get("iShare:layerName");

                var wmsInfoOpts = {
                    "INFO_FORMAT": "application/vnd.ogc.gml",
                    'FEATURE_COUNT': 10
                };
                // Pick up features within 10 pixels of the click
                wmsInfoOpts["map.layer[" + layerName + "]"] = "TOLERANCE+10+TOLERANCEUNITS+PIXELS";

                var wmsInfoUrl = layer.getSource().getGetFeatureInfoUrl(
                    coordinate,
                    map.getView().getResolution(),
                    map.getView().getProjection(),
                    wmsInfoOpts
                );

                reqwest({
                    url: wmsInfoUrl
                }).then(function(resp) {
                    // Store the response in the appropriate index in the
                    // results Array
                    results[index] = resp;
                    // Determine if all results are now present
                    for (var i = 0; i < results.length; i++) {
                        if (results[i] == null) {
                            // If we find that one of the results is missing
                            // simply return and wait until all requests are
                            // complete and the results Array is full
                            return;
                        }
                    }
                    // At this point all results are in, parse them into
                    // FeatureCollections
                    var reader = new ol.format.WMSGetFeatureInfo();
                    var collections = results.map(function(resp) {
                        return reader.readFeatures(resp.responseText);
                    });
                    callback(null, infoLayers, collections);
                });

            });
        },
        getInfoLayers: function(layerGroup) {
            return LiteMap.ol.findLayers(layerGroup, function(layer) {
                var layerConfig = layer.get("iShare:config");
                return layer.getVisible() && layerConfig && layerConfig.infoClick;
            });
        }
    };

    LiteMap.ol = {
        findLayers: function(layerGroup, filterFunc) {
            var layers = [];
            function find(lyrGroup, guid) {
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
        getGroupByGuid: function(layerGroup, guid) {
            try {
                return iShare.LiteMap.ol.findLayers(layerGroup, function(lyr) {
                    return lyr.get('iShare:guid') === guid;
                })[0];
            } catch (e) {
                return null;
            }
        }
    };

    LiteMap.createGroup = function(profile, guid) {
        var groupConfig = LiteMap.profile.getGroupConfig(profile.layerGroups, guid);
        var group = new ol.layer.Group({
            'iShare:guid': groupConfig.guid,
            "iShare:config": {},
            'title': groupConfig.displayName
        });
        return group;
    };

    LiteMap.createOverlay = function(profile, layerName) {
        var layerConfig = LiteMap.profile.getLayerConfig(profile.layerGroups, layerName);
        var source = new ol.source.ImageWMS({
            "url": profile.overlays.wmsUrl,
            "params": {
                'LAYERS': layerName
            },
            "extent": profile.extent
        });
        var layer = new ol.layer.Image({
            "source": source,
            "iShare:layerName": layerName,
            "iShare:config": layerConfig,
            "title": layerConfig.displayName
        });
        return layer;
    };

    LiteMap.createMap = function(target) {

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
    function liteMap(options, callback) {

        var lite = new LiteMap(options);

        lite.on("load", function(evt) {
            callback(null, evt.target);
        });

        return lite;

    }

    // -- Utility --


    // Constants used to covert for scale to resoluton and back
    var DOTS_PER_INCH = 72,
        INCHES_PER_METER = 2.54 / (DOTS_PER_INCH * 100);

    /**
    * Convert a scale value to it's corresponding resolution.
    * Assumes units are in meters and fixed DPI.
    */
    function scaleToResolution(scale) {
        return scale * INCHES_PER_METER;
    }

    /**
    * Convert a resolution value to it's corresponding scale.
    * Assumes units are in meters and fixed DPI.
    */
    function resolutionToScale(res) {
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
    function nearestZoom(meters, pixels, resolutions) {
        var items = resolutions.map(function (res, idx) {
            var item = {'res': res, 'zoom': idx, 'meters': res * pixels};
            item.diff = Math.abs(item.meters - meters);
            return item;
        });
        var nearest = items.sort(function(a, b) {return a.diff - b.diff;});
        return nearest[0].zoom;
    }


    // -- Plugins --

    /**
     * Minimal Plugin interface
     */
    function Plugin() {
    }

    Plugin.prototype.setApp = function(lite) {
        this.lite = lite;
    };

    /**
     * InfoPopup plugin
     */
    function InfoPopup() {
        this.popupId = 'iShare:InfoPopup';
        Plugin.call(this);
    }

    InfoPopup.prototype = Object.create(Plugin.prototype);
    InfoPopup.prototype.constructor = InfoPopup;

    InfoPopup.prototype.setApp = function(lite) {

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

    InfoPopup.prototype.onSingleClick = function(evt) {

        // Show wait cursor while we are requesting info
        evt.map.getViewport().classList.add('wait');

        function displayInfoResults(error, infoLayers, featureCollections) {

            /* jshint validthis: true */

            // Remove wait cursor
            evt.map.getViewport().classList.remove('wait');

            var popup = evt.map.getOverlayById(this.popupId);
            if (!popup) {
                popup = new ol.Overlay.Popup({id: this.popupId});
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

    return {
        LiteMap: LiteMap,
        liteMap: liteMap,
        plugins: {
            "InfoPopup": InfoPopup
        }
    };

})();

// Polyfils

// https://tc39.github.io/ecma262/#sec-array.prototype.find
if (!Array.prototype.find) {
    Object.defineProperty(Array.prototype, 'find', {
        value: function(predicate) {
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
