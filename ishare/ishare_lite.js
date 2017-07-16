var liteMap = (function () {

    function getProfile(options, callback) {

        var mapSourceUrl = options.iShareUrl + "getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=" + options.profile;

        reqwest({
            url: mapSourceUrl,
            type: 'jsonp'
        }).then(function (mapSource) {
            console.log(JSON.stringify(mapSource));
            var baseUrl = options.iShareUrl + 'getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=' + mapSource.defaultBaseMap;
            reqwest({
                url: baseUrl,
                type: 'jsonp'
            }).then(function (baseMap) {
                // console.log(JSON.stringify(baseMap));
                var profile = {
                    extent: mapSource.bounds,
                    projection: mapSource.projection,
                    initialView: mapSource.initialView,
                    units: mapSource.units,
                    resolutions: baseMap.baseMapDefinition.scales.map(scaleToResolution),
                    attribution: baseMap.baseMapDefinition.copyright,
                    basemap: {
                        url: baseMap.baseMapDefinition.uri[0],
                        layers: [baseMap.baseMapDefinition.name],
                        format: baseMap.baseMapDefinition.options.format
                    },
                    layerGroups: mapSource.layerGroups,
                    overlays: {
                        wmsUrl: options.iShareUrl + 'getows.ashx?mapsource=' + options.profile
                    },
                    view: options.view
                };
                callback(null, profile);
            });
        });

    }

    function createGroup(profile, guid) {
        var groupDef = getGroupDef(profile.layerGroups, guid);
        console.log(groupDef);
        var group = new ol.layer.Group({
            'title': groupDef.displayName,
            'iShare:guid': groupDef.guid
        });
        return group;
    }

    function createOverlay(profile, layerName) {
        var layerDef = getLayerDef(profile.layerGroups, layerName);
        var source = new ol.source.ImageWMS({
            "url": profile.overlays.wmsUrl,
            "params": {
                'LAYERS': layerName
            },
            "extent": profile.extent
        });
        var layer = new ol.layer.Image({
            "source": source,
            // TODO Only add an id and config custom settings, make the layer
            // definition nice in getProfile (infoClick:Boolean, remove old
            // properties etc.)
            "iShare:id": layerName,
            "iShare:config": layerDef,
            "iShare:type": "overlay",
            "iShare:infoClick": Boolean(layerDef.infoClick),
            "title": layerDef.displayName
        });
        return layer;
    }

    function createMap(profile, target) {

        var proj = profile.projection;
        proj4.defs(proj.SRS + ':' + proj.SRID, proj.definition);
        var projection = ol.proj.get('EPSG:27700');

        var map = new ol.Map({
            target: target,
            layers: [
                new ol.layer.Tile({
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
            ],
            view: new ol.View({
                projection: projection,
                resolutions: profile.resolutions,
                center: [profile.view.easting, profile.view.northing],
                zoom: 5
            })
        });

        map.getView().setZoom(nearestZoom(profile.view.zoom, map.getSize()[0], profile.resolutions));

        var layerSwitcher = new ol.control.LayerSwitcher({id: 'iShare:layers'});
        map.addControl(layerSwitcher);

        return map;

    }

    function enableInfoClick(lite) {

        var profile = lite.profile;
        var map = lite.map;

        if (lite.popup && map.getOverlayById(lite.popup.getId())) {
            // All good we already have a popup instance
        } else {
            lite.popup = new ol.Overlay.Popup({id: 'iShare:info'});
            map.addOverlay(lite.popup);
        }

        lite.onInfoClick = function(evt) {

            // Show wait cursor while we are requesting info
            evt.map.getViewport().classList.add('wait');

            function displayInfoResults(results) {

                // Remove wait cursor
                evt.map.getViewport().classList.remove('wait');

                var reader = new ol.format.WMSGetFeatureInfo()
                var collections = results.map(function(resp) {
                    return reader.readFeatures(resp.responseText);
                });

                var html = collections.map(function(collection, index) {
                    // Get a reference to the layer based on the index of the
                    // response in the results Array
                    var layer = infoLayers[index];
                    var layerDef = getLayerDef(profile.layerGroups, layer.get("iShare:id"));
                    var html = '';
                    if (layerDef.infoClick) {
                        var collectionHtml = collection.map(function(feature) {
                            var html = '<div class="infoResult">';
                            html += layerDef.fields.map(function(field) {
                                return '<p><strong>' + field.displayName + '</strong> <span>' + feature.get(field.name) + '</span> </p>';
                            }).join('\n');
                            html += '</div>';
                            return html;
                        }).join('\n');
                        if (collectionHtml.length) {
                            html = '<div class="contentDisplay"><h3>' + layerDef.displayName + '</h3>';
                            html += collectionHtml;
                            html += '</div>';
                        }
                    }
                    return html;
                }).join('\n');

                if (html.trim().length) {
                    lite.popup.show(evt.coordinate, html);
                } else {
                    lite.popup.hide();
                }

            }

            // TODO Get a list of layers from the map itself
            var infoLayers = olUtil.getAllLayers(evt.map.getLayerGroup()).filter(function(layer) {
                return layer.get('iShare:type') === 'overlay' && layer.get('iShare:infoClick');
            });
            console.log(infoLayers);
            infoLayers.forEach(function(layer) {
                console.log(layer.get('title'));
            });

            // Create an empty Array to store the results of the GetFeatureInfo
            // requests in
            var results = Array(infoLayers.length)

            infoLayers.forEach(function(layer, index) {

                var wmsInfoOpts = {
                    'INFO_FORMAT': 'application/vnd.ogc.gml',
                    'FEATURE_COUNT': 10
                };
                // Pick up features within 10 pixels of the click
                wmsInfoOpts['map.layer[' + layer.get('iShare:id') + ']'] = 'TOLERANCE+10+TOLERANCEUNITS+PIXELS';

                var wmsInfoUrl = layer.getSource().getGetFeatureInfoUrl(
                    evt.coordinate,
                    evt.map.getView().getResolution(),
                    evt.map.getView().getProjection(),
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
                        if (results[i] == undefined) {
                            // If we find that one of the results is missing
                            // simply return and wait until all requests are
                            // complete and the results Array is full
                            return;
                        }
                    }
                    // At this point all results are in
                    displayInfoResults(results);
                });

            });
        };

        map.un('singleclick', lite.onInfoClick);
        map.on('singleclick', lite.onInfoClick);

        return lite;

    }

    /**
     * Create an OpenLayers map pre-configured with base map, overlays etc.
     * defined in iShare profile (MapSource) and specified options
     */
    function liteMap(options, callback) {

        options.layers = options.layers.split(',');

        var lite = {"type": "LITE"};

        getProfile(options, function(err, profile) {
            console.log(profile);

            lite.profile = profile;

            // Create basic map
            var map = createMap(profile, options.target);
            lite.map = map;

            // var visibleLayers = getLayerDefs(profile.layerGroups).filter(function(layerDef) {
            //     return layerDef.initiallyVisible || options.layers.indexOf(layerDef.layerName) > -1;
            // });

            // Loop through each group in profile
            // if the group contains a visible layer, create it, add it to the map then create the visible layer(s) and add those to the group

            for (var m = 0, g; m < profile.layerGroups.length; m++) {
                g = profile.layerGroups[m];
                for (var n = 0, l; n < g.layers.length; n++) {
                    l = g.layers[n];
                    if (l.initiallyVisible || options.layers.indexOf(l.layerName) > -1) {
                        // Find the existing group or create and add it to the map
                        var group = olUtil.getGroupByGuid(lite.map.getLayerGroup(), g.guid);
                        if (!group) {
                             group = createGroup(lite.profile, g.guid);
                            lite.map.addLayer(group);
                        }
                        // Create the layer and add it to the group
                        var layer = createOverlay(lite.profile, l.layerName);
                        group.getLayers().push(layer);
                    }
                }
            }

            // TODO instead of storing a list against the lite Object look them up from the map itself
            // lite.overlays = visibleLayers.map(function(layerDef) {
            //     var layerName = layerDef.layerName;
            //     return createOverlay(lite.profile, layerName);
            // });

            // visibleLayers.forEach(function(layerDef) {
            //     // TODO Ensure groups and layers are added in the correct draw order
            //     var groupDef = getGroupDefByLayerName(profile.layerGroups, layerDef.layerName);
            //     var group = olUtil.getGroupByGuid(lite.map.getLayerGroup(), groupDef.guid) || createGroup(lite.profile, groupDef.guid);
            //     lite.map.addLayer(group);
            //     group.getLayers().push(layer);
            // });

            // By default add infoOnClick functionality
            if (!options.functionality || (!options.functionality.hasOwnProperty('infoOnClick') || options.functionality.infoOnClick)) {
                enableInfoClick(lite);
            }

            callback(null, lite);

        });


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

    function groupDefContains(layerGroups, groupDef, layerName) {
        for (var n = 0, l; n < groupDef.layers.length; n++) {
            l = groupDef.layers[n];
            if (l.layerName === layerName) {
                return true;
            }
        }
        return false;
    }

    /**
     * Returns a flattened list of all layers found in layerGroups
     */
    function getLayerDefs(layerGroups) {
        var layerDefs = [];
        for (var m = 0, g; m < layerGroups.length; m++) {
            g = layerGroups[m];
            for (var n = 0, l; n < g.layers.length; n++) {
                l = g.layers[n];
                layerDefs.push(l);
            }
        }
        return layerDefs;
    }

    /**
     * Returns the layer definition with layerName or null if not found
     */
    function getLayerDef(layerGroups, layerName) {
        try {
            return getLayerDefs(layerGroups).filter(function(layerDef) {
                return layerDef.layerName === layerName;
            })[0];
        } catch (e) {
            return null;
        }
    }

    /**
     * Return the group definition with the given guid
     */
    function getGroupDef(layerGroups, guid) {
        for (var m = 0, g; m < layerGroups.length; m++) {
            g = layerGroups[m];
            if (g.guid === guid) {
                return g;
            }
        }
        return null;
    }

    // /**
    //  * Returns the group associated with the layerName or null if not found
    //  */
    // function getGroupDefByLayerName(layerGroups, layerName) {
    //     for (var m = 0, g; m < layerGroups.length; m++) {
    //         g = layerGroups[m];
    //         for (var n = 0, l; n < g.layers.length; n++) {
    //             l = g.layers[n];
    //             if (l.layerName === layerName) {
    //                 return g;
    //             }
    //         }
    //     }
    //     return null;
    // }

    var olUtil = {
        getInfoLayers: function(map) {

        },
        getOverlayLayers: function(map) {
        },
        getAllLayers: function(layerGroup) {
            var layers = [];
            function find(lyrGroup, guid) {
                var ls = lyrGroup.getLayers().getArray();
                for (var n = 0, l; n < ls.length; n++) {
                    l = ls[n];
                    layers.push(l);
                    if (l.getLayers) {
                        find(l, guid);
                    }
                }
            }
            find(layerGroup);
            return layers;
        },
        getGroupByGuid: function(lyrGroup, guid) {
            function find(lyrGroup, guid) {
                var layers = lyrGroup.getLayers().getArray();
                for (var n = 0, l; n < layers.length; n++) {
                    l = layers[n];
                    if (l.get('iShare:guid') === guid) {
                        return l;
                    }
                    if (l.getLayers) {
                        l = find(l, guid);
                        if (l) {
                            return l;
                        }
                    }
                }
                return null;
            }
            return find(lyrGroup, guid);
        }
    };

    return {
        liteMap: liteMap,
        createMap: createMap,
        createOverlay: createOverlay,
        enableInfoClick: enableInfoClick,
        olUtil: olUtil
    };

})();
