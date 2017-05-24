var liteMap = (function () {

    var map;

    function liteMap(options) {

        var mapSourceUrl = options.iShareUrl + "getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=" + options.mapSource;
        var overlayWmsUrl = options.iShareUrl + 'getows.ashx?mapsource=' + options.mapSource;
        var overlayInfoUrl = options.iShareUrl + 'mapgetimage.aspx?callback=?&Type=jsonp&RequestType=GeoJSON&ActiveTool=MultiInfo&ActiveLayer=&ServiceAction=GetMultiInfoFromPoint&MapSource=' + options.mapSource + '&Layers=' + options.layers;

        reqwest({
            url: mapSourceUrl,
            type: 'jsonp'
        }).then(function (data) {
            var baseUrl = options.iShareUrl + 'getdata.aspx?callback=?&type=jsonp&service=MapSource&RequestType=JSON&ms=' + data.defaultBaseMap;
            reqwest({
                url: baseUrl,
                type: 'jsonp'
            }).then(function (data) {
                var opts = {
                    extent: data.bounds,
                    resolutions: _map(data.baseMapDefinition.scales, scaleToResolution),
                    copyright: data.baseMapDefinition.copyright,
                    basemap: {
                        url: data.baseMapDefinition.uri.split('|')[0],
                        layers: [data.baseMapDefinition.name],
                        format: data.baseMapDefinition.options.format
                    },
                    overlays: {
                        wmsUrl: overlayWmsUrl,
                        infoUrl: overlayInfoUrl,
                        layers: options.layers.split(','),
                        format: 'image/png'
                    },
                    view: options.view
                };
                ol3Map(opts);
            });
        });

    }

    function ol3Map(options) {

        // Define British National Grid Proj4js projection (copied from http://epsg.io/27700.js)
        proj4.defs("EPSG:27700","+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs");
        var projection = ol.proj.get('EPSG:27700');
        projection.setExtent(options.extent);

        var overlaySource = new ol.source.ImageWMS({
            url: options.overlays.wmsUrl,
            params: {
                'LAYERS': options.overlays.layers.join(',')
            },
            extent: options.extent
        });

        map = new ol.Map({
            target: 'map',
            layers: [
                new ol.layer.Tile({
                    source: new ol.source.TileWMS({
                        url: options.basemap.url,
                        attributions: [
                            new ol.Attribution({html: options.copyright})
                        ],
                        params: {
                            'LAYERS': options.basemap.layers.join(','),
                            'FORMAT': options.basemap.format
                        },
                        tileGrid: new ol.tilegrid.TileGrid({
                            origin: options.extent.slice(0, 2),
                            resolutions: options.resolutions
                        })
                    })
                }),
                new ol.layer.Image({
                    source: overlaySource
                })
            ],
            view: new ol.View({
                projection: projection,
                resolutions: options.resolutions,
                center: [options.view.easting, options.view.northing],
                zoom: 5
            })
        });

        map.getView().setZoom(nearestZoom(options.view.zoom, map.getSize()[0], options.resolutions));

        var popup = new ol.Popup();
        map.addOverlay(popup);

        map.on('singleclick', function(evt) {
            var url = options.overlays.infoUrl + '&Easting=' + evt.coordinate[0] + '&Northing=' + evt.coordinate[1];
            if (url) {
                reqwest({
                    url: url,
                    type: 'jsonp'
                }).then(function (data) {
                    if (data.length) {
                        var html = '';
                        for (var n = 0, l; n < data.length; n++) {
                            l = data[n];
                            html += l.properties.htmlHeader;
                            for (var m = 0, f; m < l.features.length; m++) {
                                f = l.features[m];
                                html += f.properties.html;
                            }
                            html += l.properties.htmlFooter;
                        }
                        popup.show(evt.coordinate, html);
                    } else {
                        popup.hide();
                    }
                });
            }
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
        // To calculate the zoom (level) we need the map width in pixels, then we
        // convert the resolutions to meters (res * w) and find the closest
        // resolution then look up it's index in the resolutions array
        // var resInfo = function (res, idx) {
        //     var item = {'res': res, 'zoom': idx, 'meters': res * pixels}
        //     item.diff = Math.abs(item.meters - meters);
        //     return item;
        // }
        // var items = [];
        // for (var i = 0; i < resolutions.length; i++) {
        //     items.push(resInfo(resolutions[i], i));
        // }
        var items = _map(resolutions, function (res, idx) {
            var item = {'res': res, 'zoom': idx, 'meters': res * pixels}
            item.diff = Math.abs(item.meters - meters);
            return item;
        });
        var nearest = items.sort(function(a, b) {return a.diff - b.diff});
        return nearest[0].zoom;
    }

    function _map(l, f) {
        var items = [];
        for (var i = 0; i < l.length; i++) {
            items.push(f(l[i], i));
        }
        return items;
    }

    return {
        liteMap: liteMap,
        getMap: function() {
            return map;
        }
    };

})();
