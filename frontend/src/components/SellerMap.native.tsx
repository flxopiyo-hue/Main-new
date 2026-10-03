// Small, read-only approximate-location map for native (iOS / Android /
// Expo Go). Renders an OpenStreetMap Leaflet page inside a WebView — no
// API key required. We draw a circle (not a precise pin) because we only
// have city-centre coordinates.
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import { colors } from "@/src/lib/theme";

interface Props {
  lat: number;
  lon: number;
  accent?: string;
}

export default function SellerMap({ lat, lon, accent = colors.primary }: Props) {
  const html = useMemo(
    () => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#EDE6D8}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var lat=${JSON.stringify(lat)}, lon=${JSON.stringify(lon)};
  var map=L.map('map',{zoomControl:false,attributionControl:true,scrollWheelZoom:false,dragging:true,doubleClickZoom:false}).setView([lat,lon],12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  L.circle([lat,lon],{radius:1400,color:${JSON.stringify(accent)},weight:2,fillColor:${JSON.stringify(accent)},fillOpacity:0.18}).addTo(map);
</script></body></html>`,
    [lat, lon, accent],
  );

  return (
    <View style={styles.wrap}>
      <WebView
        testID="seller-map-webview"
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.web}
        scrollEnabled={false}
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.muted },
  web: { flex: 1, backgroundColor: "transparent" },
});
