// Extent of the map in units of the projection
var extent = [-3276800, -3276800, 3276800, 3276800];

// Fixed resolutions to display the map at
var resolutions = [1600,800,400,200,100,50,25,10,5,2.5,1,0.5,0.25,0.125,0.0625];

// Define British National Grid Proj4js projection (copied from http://epsg.io/27700.js)
proj4.defs("EPSG:27700","+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs");

// Define a projection based on the included Proj4js projection definition.
// Include the extent here and specify the resolutions as a property of the
// View to specify the zoom levels that are available to the user.
var bng = ol.proj.get('EPSG:27700');
bng.setExtent(extent);

var map = new ol.Map({
    target: 'map',
    layers: [
        new ol.layer.Tile({
            source: new ol.source.TileWMS({
                url: 'http://t0.ads.astuntechnology.com/astuntechnology/osopen/service?',
                attributions: [
                    new ol.Attribution({html: 'Astun Data Service &copy; Ordnance Survey.'})
                ],
                params: {
                    'LAYERS': 'osopen',
                    'FORMAT': 'image/png',
                    'TILED': true
                },
                // Define a TileGrid to ensure that WMS requests are made for
                // tiles at the correct resolutions and tile boundaries
                tileGrid: new ol.tilegrid.TileGrid({
                    origin: extent.slice(0, 2),
                    resolutions: resolutions
                })
            })
        })
    ],
    view: new ol.View({
        projection: bng,
        resolutions: resolutions,
        center: [413674, 289141],
        zoom: 0
    })
});
