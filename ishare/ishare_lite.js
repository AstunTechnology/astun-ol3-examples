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

    function createOverlay(profile, layerName) {
        var overlaySource = new ol.source.ImageWMS({
            url: profile.overlays.wmsUrl,
            params: {
                'LAYERS': layerName
            },
            extent: profile.extent
        });
        var overlayLayer = new ol.layer.Image({
            source: overlaySource,
            "iShare:layerName": layerName
        });
        return overlayLayer;
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

            function displayInfoResults(results) {
                var reader = new ol.format.WMSGetFeatureInfo()
                var collections = results.map(function(resp) {
                    return reader.readFeatures(resp.responseText);
                });
                var html = collections.map(function(collection, index) {
                    // Get a reference to the layer based on the index of the
                    // response in the results Array
                    var layer = lite.overlays[index];
                    var layerDef = getLayerDef(profile.layerGroups, layer.get("iShare:layerName"));
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

            // Create an empty Array to store the results of the GetFeatureInfo
            // requests in
            var results = Array(lite.overlays.length)

            lite.overlays.forEach(function(layer, index) {

                var wmsInfoOpts = {
                    'INFO_FORMAT': 'application/vnd.ogc.gml',
                    'FEATURE_COUNT': 10
                };
                // Pick up features within 10 pixels of the click
                wmsInfoOpts['map.layer[' + layer.get('iShare:layerName') + ']'] = 'TOLERANCE+10+TOLERANCEUNITS+PIXELS';

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

            var visibleLayers = getLayerDefs(profile.layerGroups).filter(function(layerDef) {
                return layerDef.initiallyVisible || options.layers.indexOf(layerDef.layerName) > -1;
            });

            lite.overlays = visibleLayers.map(function(layerDef) {
                var layerName = layerDef.layerName;
                return createOverlay(lite.profile, layerName);
            });
            lite.overlays.forEach(function(layer) {
                // TODO Ensure layers are added in the correct draw order
                lite.map.addLayer(layer);
            });

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

    return {
        liteMap: liteMap,
        createMap: createMap,
        createOverlay: createOverlay,
        enableInfoClick: enableInfoClick
    };

})();
