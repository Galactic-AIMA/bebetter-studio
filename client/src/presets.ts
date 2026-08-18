// Los presets se comparten con el servidor (ver `@shared/presets`): el lote sin
// navegador necesita los mismos valores de marca. Este archivo se queda como
// reexport para no cambiar los imports del cliente.
export * from '@shared/presets'
export type { PresetDef } from '@shared/presets'
