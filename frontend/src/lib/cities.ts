// Common Kenyan cities/towns used across seller-registration and address
// pickers. Sorted by population, capital first. Includes an "Other" option
// on the picker side (handled by PickerField's `allowCustom` flag).
//
// Extend this list carefully — the picker exposes a search field, so
// coverage of top ~30 towns is enough for the vast majority of sellers.

export interface CityOption {
  value: string;
  label: string;
  county?: string;
}

export const KENYAN_CITIES: CityOption[] = [
  { value: "Nairobi", label: "Nairobi", county: "Nairobi County · Capital" },
  { value: "Mombasa", label: "Mombasa", county: "Mombasa County · Coast" },
  { value: "Kisumu", label: "Kisumu", county: "Kisumu County · Nyanza" },
  { value: "Nakuru", label: "Nakuru", county: "Nakuru County · Rift Valley" },
  { value: "Eldoret", label: "Eldoret", county: "Uasin Gishu County" },
  { value: "Thika", label: "Thika", county: "Kiambu County" },
  { value: "Malindi", label: "Malindi", county: "Kilifi County" },
  { value: "Kitale", label: "Kitale", county: "Trans-Nzoia County" },
  { value: "Kakamega", label: "Kakamega", county: "Kakamega County" },
  { value: "Nyeri", label: "Nyeri", county: "Nyeri County" },
  { value: "Meru", label: "Meru", county: "Meru County" },
  { value: "Machakos", label: "Machakos", county: "Machakos County" },
  { value: "Naivasha", label: "Naivasha", county: "Nakuru County" },
  { value: "Kericho", label: "Kericho", county: "Kericho County" },
  { value: "Kisii", label: "Kisii", county: "Kisii County" },
  { value: "Bungoma", label: "Bungoma", county: "Bungoma County" },
  { value: "Embu", label: "Embu", county: "Embu County" },
  { value: "Garissa", label: "Garissa", county: "Garissa County" },
  { value: "Kilifi", label: "Kilifi", county: "Kilifi County" },
  { value: "Voi", label: "Voi", county: "Taita-Taveta County" },
  { value: "Wajir", label: "Wajir", county: "Wajir County" },
  { value: "Lamu", label: "Lamu", county: "Lamu County" },
  { value: "Isiolo", label: "Isiolo", county: "Isiolo County" },
  { value: "Nanyuki", label: "Nanyuki", county: "Laikipia County" },
  { value: "Nyahururu", label: "Nyahururu", county: "Laikipia County" },
  { value: "Kerugoya", label: "Kerugoya", county: "Kirinyaga County" },
  { value: "Homa Bay", label: "Homa Bay", county: "Homa Bay County" },
  { value: "Migori", label: "Migori", county: "Migori County" },
  { value: "Siaya", label: "Siaya", county: "Siaya County" },
  { value: "Kajiado", label: "Kajiado", county: "Kajiado County" },
];
