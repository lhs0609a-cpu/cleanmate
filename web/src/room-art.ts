/** Small, theme-aware furniture drawings. Status and click targets stay in the DOM. */
const furniture: Record<string, string> = {
  bed: '<path d="M8 31V15h48v16M8 24h48v20H8Zm0 20v5m48-5v5M13 18h16v6H13Zm22 0h16v6H35Z"/>',
  desk: '<path d="M5 29h54v6H5Zm5 6v18m44-18v18M18 8h28v17H18Zm14 17v4M47 35v10h7"/>',
  wardrobe: '<rect x="13" y="6" width="38" height="49" rx="3"/><path d="M32 6v49M26 28v7m12-7v7M17 55v4m30-4v4"/>',
  pc: '<rect x="7" y="8" width="50" height="35" rx="4"/><path d="M26 43v10h12V43M19 54h26M14 15h15v12H14Zm22 0h14v12H36Z"/>',
  storage: '<rect x="12" y="9" width="40" height="46" rx="3"/><path d="M12 24h40M12 40h40M28 16h8m-8 16h8m-8 16h8"/>',
  kitchen: '<path d="M6 29h52v26H6Zm27 0v26M11 29v-8h18v8m-8-8V11q0-7 8-7v7M41 36h10"/>',
  bath: '<path d="M7 28h50v10q0 13-13 13H20Q7 51 7 38Zm6 0V12q0-9 9-9v9M17 51v7m30-7v7M19 15h6"/>',
  living: '<path d="M12 30V17q0-5 5-5h30q5 0 5 5v13M5 27h10v13h34V27h10v24H5Zm5 24v6m44-6v6M32 12v28"/>',
  entry: '<path d="M17 57V7h30v50M11 57h42M23 14h18v43M35 33h1M6 45h7v12H6Z"/>',
}
export function roomArt(id: string): string {
  return `<svg class="room-art" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${furniture[id] ?? furniture.storage}</svg>`
}
