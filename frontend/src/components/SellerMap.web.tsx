// Small, read-only approximate-location map for web (react-native-web).
// Uses react-leaflet + OpenStreetMap tiles — no API key required. We draw
// a circle (not a precise pin) because we only have city-centre coords.
import "leaflet/dist/leaflet.css";

import React from "react";
import { Circle, MapContainer, TileLayer } from "react-leaflet";

import { colors } from "@/src/lib/theme";

interface Props {
  lat: number;
  lon: number;
  accent?: string;
}

export default function SellerMap({ lat, lon, accent = colors.primary }: Props) {
  return (
    <MapContainer
      center={[lat, lon]}
      zoom={12}
      scrollWheelZoom={false}
      style={{ width: "100%", height: "100%" }}
      attributionControl
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <Circle
        center={[lat, lon]}
        radius={1400}
        pathOptions={{ color: accent, weight: 2, fillColor: accent, fillOpacity: 0.18 }}
      />
    </MapContainer>
  );
}
