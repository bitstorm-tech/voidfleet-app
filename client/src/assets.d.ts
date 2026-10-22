// Bun bündelt unbekannte Dateitypen mit dem file-Loader und liefert die URL.
declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.glb" {
  const url: string;
  export default url;
}
