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

        var baseMaps = new ol.layer.Group({
            'iShare:guid': 'basemaps',
            'iShare:config': {},
            'title': 'Base maps',
            'layers': [
                new ol.layer.Tile({
                    'title': profile.basemap.displayName,
                    'type': 'base',
                    source: new ol.source.TileWMS({
                        url: profile.basemap.url,
                        attributions: [
                            new ol.Attribution({html: profile.attribution})
                        ],
                        params: {
                            'LAYERS': profile.basemap.layers.join(','),
                            'FORMAT': profile.basemap.format
                        },
                        tileGrid: new ol.tilegrid.TileGrid({
                            origin: profile.extent.slice(0, 2),
                            resolutions: profile.resolutions
                        })
                    })
                })
            ]
        });

        this.map.addLayer(baseMaps);

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
        }
        return plugin;
    };

    LiteMap.defaultPlugins = function() {
        return [new InfoPopup()];
    }

    LiteMap.getProfile = function(iShareUrl, profileName, callback) {

        var mapSourcesUrl = iShareUrl + "getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=root";

        reqwest({
            url: mapSourcesUrl,
            type: 'jsonp'
        }).then(function (rootMapSource) {
            console.log(JSON.stringify(rootMapSource));

            var mapSourceUrl = iShareUrl + "getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=" + profileName;

            reqwest({
                url: mapSourceUrl,
                type: 'jsonp'
            }).then(function (mapSource) {
                // console.log(JSON.stringify(mapSource));

                var layerGroups = mapSource.layerGroups.map(function(group) {
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

                // TODO Get all base map definitions
                var baseUrl = iShareUrl + 'getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=' + mapSource.defaultBaseMap;

                reqwest({
                    url: baseUrl,
                    type: 'jsonp'
                }).then(function (baseMap) {
                    // console.log(JSON.stringify(baseMap));

                    var profile = {
                        defaultProfile: rootMapSource.defaultMapSource,
                        profiles: rootMapSource.mapSources,
                        baseMaps: rootMapSource.baseMapSources,
                        extent: mapSource.bounds,
                        projection: mapSource.projection,
                        initialView: mapSource.initialView,
                        units: mapSource.units,
                        resolutions: baseMap.baseMapDefinition.scales.map(scaleToResolution),
                        attribution: baseMap.baseMapDefinition.copyright,
                        basemap: {
                            displayName: rootMapSource.baseMapSources.filter(function(ms) {
                                return ms.mapName === mapSource.defaultBaseMap;
                            })[0].displayName,
                            url: baseMap.baseMapDefinition.uri[0],
                            layers: [baseMap.baseMapDefinition.name],
                            format: baseMap.baseMapDefinition.options.format
                        },
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
            return html
        },
        getInfoAtPoint: function(map, infoLayers, coordinate, callback) {
            // Create an empty Array to store the results of the GetFeatureInfo
            // requests in
            var results = Array(infoLayers.length)

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
                    var reader = new ol.format.WMSGetFeatureInfo()
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
            var item = {'res': res, 'zoom': idx, 'meters': res * pixels}
            item.diff = Math.abs(item.meters - meters);
            return item;
        });
        var nearest = items.sort(function(a, b) {return a.diff - b.diff});
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

