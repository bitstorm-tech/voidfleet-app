// Mit `with { type: "file" }` importiert, liefert Bun den Pfad der Datei (in der kompilierten Binary eingebettet).
declare module "*.png" {
  const path: string;
  export default path;
}
