"use client";

import { Briefcase } from "lucide-react";
import DimensionValueManager from "@/components/dimension-value-manager";

export default function CostCentrePage() {
  return (
    <DimensionValueManager
      typeCode="CC"
      title="Cost Centre"
      blurb="Departments, teams, and activity buckets used for internal cost allocation, budgeting, and management reporting."
      icon={Briefcase}
      iconColor="text-sky-600"
      rail="bg-sky-500"
      addLabel="Add cost centre"
      codePlaceholder="CC_FIN"
      namePlaceholder="Finance"
    />
  );
}
