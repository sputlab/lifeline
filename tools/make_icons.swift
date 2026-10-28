// Genera tutte le icone della PWA a partire da assets/icons/master.png.
// Uso (dalla radice del progetto): swift tools/make_icons.swift
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let dir = "assets/icons"
let bg = CGColor(red: 0.043, green: 0.055, blue: 0.078, alpha: 1) // #0b0e14

guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: "\(dir)/master.png") as CFURL, nil),
      let master = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    FileHandle.standardError.write("master.png non trovato\n".data(using: .utf8)!); exit(1)
}

/// scale: 1 = icona a filo; >1 ritaglia gli angoli arrotondati; <1 lascia margine.
func render(size: Int, scale: CGFloat, background: Bool, name: String) {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    let s = CGFloat(size)
    if background { ctx.setFillColor(bg); ctx.fill(CGRect(x: 0, y: 0, width: s, height: s)) }
    let d = s * scale
    ctx.draw(master, in: CGRect(x: (s - d) / 2, y: (s - d) / 2, width: d, height: d))
    let out = URL(fileURLWithPath: "\(dir)/\(name)") as CFURL
    let dest = CGImageDestinationCreateWithURL(out, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
    CGImageDestinationFinalize(dest)
}

// Icone "any" con trasparenza (manifest, favicon)
for n in [16, 32, 48, 72, 96, 128, 144, 152, 192, 256, 384, 512] {
    render(size: n, scale: 1, background: false, name: "icon-\(n).png")
}
// Maskable: sfondo pieno, contenuto nella zona sicura (80%)
for n in [192, 512] {
    render(size: n, scale: 0.8, background: true, name: "maskable-\(n).png")
}
// iOS: senza trasparenza, angoli ritagliati (iOS applica la propria maschera)
for n in [120, 152, 167, 180] {
    render(size: n, scale: 1.1, background: true, name: "apple-touch-icon-\(n).png")
}
render(size: 180, scale: 1.1, background: true, name: "apple-touch-icon.png")
print("Icone generate in \(dir)/")
