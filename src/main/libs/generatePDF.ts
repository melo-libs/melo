import { BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'

/* Render a complete, self-styled HTML document (the export template) in a
   hidden window and print it to PDF. */

async function generatePDF(htmlContent: string, savePath: string): Promise<void> {
  if (!htmlContent || htmlContent.trim() === '') {
    throw new Error('Content is empty or undefined')
  }

  const tempFilePath = path.join(app.getPath('temp'), `melo-pdf-export-${Date.now()}.html`)
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  try {
    fs.writeFileSync(tempFilePath, htmlContent, 'utf-8')
    await win.loadFile(tempFilePath)
    const data = await win.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
    })
    await fs.promises.writeFile(savePath, data)
  } finally {
    fs.unlink(tempFilePath, () => {})
    win.close()
  }
}

export { generatePDF }
