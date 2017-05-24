// The map is created and preconfigured with a base map in ../ads/ads_wms.js which
// is included before this script

// Display GeoJSON loaded via a JSONP call to iShare

// Define the URL used to fetch GeoJSON features
var url = 'http://digitalservices.surreyi.gov.uk/developmentcontrol/0.1/applications/search?status=live&gss_code=E07000214';

var popup = new ol.Popup({class: 'marker'});
map.addOverlay(popup);

map.on('click', function(evt) {
    var feature = map.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
        return feature;
    });
    if (feature) {
        var geometry = feature.getGeometry();
        var coord = geometry.getCoordinates();
        popup.show(coord, "<h2><a href='" + feature.get('caseurl') + "'>" + feature.get('casereference') + "</a></h2><p>" + feature.get('locationtext') + "</p><p>Status: " + feature.get('status') + "</p>");
    } else {
        popup.hide();
    }
});

var vectorLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
        url: url,
        format: new ol.format.GeoJSON()
    }),
    style: new ol.style.Style({
            image: new ol.style.Icon(({
                anchor: [0.5, 40],
                anchorXUnits: 'fraction',
                anchorYUnits: 'pixels',
                src: 'marker-icon.png'
            }))
        })
});

map.addLayer(vectorLayer);
vectorLayer.on('change', function() {
    map.getView().fit(vectorLayer.getSource().getExtent(), map.getSize());
});
