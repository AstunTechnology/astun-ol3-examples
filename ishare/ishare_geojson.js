// The map is created and preconfigured with a base map in ../ads/ads_wms.js which
// is included before this script

// Display GeoJSON loaded via a JSONP call to iShare

// Define the URL used to fetch features for a given area of interest
var url = 'http://national.astuntechnology.com/ishare/web//MapGetImage.aspx?callback=?&Type=jsonp&MapSource=National/AllMaps&RequestType=GeoJSON&ActiveTool=MultiInfo&ActiveLayer=&Layers=nhshospitals&mapid=-1&axuid=1387296513806&ServiceAction=GetMultiInfoFromShape&Shape=POLYGON%28%28150000%2010000%2C%20350000%2010000%2C%20350000%20150000%2C%20150000%20150000%2C%20150000%2010000%29%29';

var popup = new ol.Popup();
map.addOverlay(popup);

map.on('click', function(evt) {
    var feature = map.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
        return feature;
    });
    if (feature) {
        var geometry = feature.getGeometry();
        var coord = geometry.getCoordinates();
        popup.show(coord, feature.get('html'));
    } else {
        popup.hide();
    }
});

reqwest({url: url, type: 'jsonp'}).then(function (data) {
    // Make a valid GeoJSON object
    var vectorLayer = new ol.layer.Vector({
        source: new ol.source.GeoJSON({
            'object': prepGeoJson(data[0])
        }),
        style: new ol.style.Style({
            image: new ol.style.Icon(({
                src: 'marker.png'
            }))
        })
    });
    map.addLayer(vectorLayer);
    map.getView().fitExtent(vectorLayer.getSource().getExtent(), map.getSize());
});

function prepGeoJson(feats) {
    // Correct the geometry which is assumed to be a point.
    for (var i = 0, feat; i < feats.features.length; i++) {
        feat = feats.features[i];
        feat.geometry.coordinates = feat.geometry.coordinates[0];
        feat.geometry.type = "Point";
    }
    return feats;
}
