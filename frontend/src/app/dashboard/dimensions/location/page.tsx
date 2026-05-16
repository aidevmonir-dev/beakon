"use client";

import { MapPin } from "lucide-react";
import DimensionValueManager from "@/components/dimension-value-manager";

export default function LocationPage() {
  return (
    <DimensionValueManager
      typeCode="LOCATION"
      title="Location"
      blurb="Geographic and premises classification — countries, cities, sites, buildings. Tag transactions for location-based reporting and cost allocation."
      icon={MapPin}
      iconColor="text-violet-600"
      rail="bg-violet-500"
      addLabel="Add location"
      codePlaceholder="EU_CH_GENEVA"
      namePlaceholder="Geneva"
    />
  );
}
