// Extent of the map in units of the projection
var extent = [-3276800, -3276800, 3276800, 3276800];

// Fixed resolutions to display the map at
var resolutions = [1600, 800, 400, 200, 100, 50, 25];

// Basic ol3 Projection definition, include the extent here and specify the
// resolutions as a property of the View2D or TileWMS if you are using a tiled
// WMS to ensure tiles are requested at the correct boundaries
var projection = new ol.proj.Projection({
    code: 'EPSG:27700',
    units: 'm',
    extent: extent
});

var map = new ol.Map({
    target: 'map',
    layers: [
        new ol.layer.Tile({
            source: new ol.source.TileWMS({
                url: 'http://t0.ads.astuntechnology.com/astuntechnology/osopen/service?',
                attributions: [
                    new ol.Attribution({html: 'OS OpenData, &copy; Ordnance Survey'})
                ],
                params: {
                    'LAYERS': 'osopen',
                    'FORMAT': 'image/png',
                    'TILED': true
                }
            })
        })
    ],
    view: new ol.View2D({
        projection: projection,
        resolutions: resolutions,
        center: [315000, 468000],
        zoom: 0
    })
});
