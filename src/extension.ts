// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import axios from 'axios'
import * as cheerio from 'cheerio'
import { exec } from 'child_process'
import * as vscode from 'vscode'
import say = require('say')

function debounce(fn: Function, threshold: number = 1000) {
    let timer: NodeJS.Timeout | null = null
    return function (this: any, ...args: any) {
        if (timer) {
            clearTimeout(timer)
        }
        timer = setTimeout(() => {
            fn.apply(this, args)
        }, threshold)
    }
}

function userSayjs() {
    const configuration = vscode.workspace.getConfiguration('WordSpeaker')
    return configuration.get<boolean>('useSayjs')
}
function enable() {
    const configuration = vscode.workspace.getConfiguration('WordSpeaker')
    return configuration.get<boolean>('enable')
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated

    try {
        await vscode.workspace.fs.readDirectory(context.globalStorageUri)
    } catch {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri)
    }

    console.log(context.globalStorageUri.fsPath)

    let instance = new Speaker(context)
    context.subscriptions.push(instance)
}

class Speaker {
    private WORDRE = /[A-Za-z]+/
    private _disposable: vscode.Disposable
    private statusBarItem?: vscode.StatusBarItem
    context: vscode.ExtensionContext
    constructor(context: vscode.ExtensionContext) {
        this.context = context
        this.statusBarItem = undefined
        // 设置监听
        let subscriptions: vscode.Disposable[] = []
        vscode.window.onDidChangeTextEditorSelection(debounce(this.onChange, 500), this, subscriptions)
        this._disposable = vscode.Disposable.from(...subscriptions)
    }

    async onChange() {
        if (!enable()) {
            return
        }

        const editor = vscode.window.activeTextEditor
        const doc = editor?.document
        const sText = doc?.getText(editor?.selection)
        if (!sText) {
            return
        }
        if (sText.length > 100) {
            return
        }

        if (!this.statusBarItem) {
            this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
        }

        const words = sText
            .replace(/([A-Z])/g, ',$1')
            .toLowerCase()
            .split(',')
            .map((s) => {
                const res = this.WORDRE.exec(s)
                if (res) {
                    return res[0]
                }
                return ''
            })
            .filter((w) => w.length > 0)

        if (userSayjs()) {
            say.stop()
            const sentence = words.join(' ').trim()
            if (sentence.length) {
                say.speak(sentence)
            }
            return
        }

        Promise.all(words.map((w) => this.say(w)))
            .then((result) => {
                const cmd = result
                    .filter((v) => {
                        if (!v || v?.length === 0) {
                            return false
                        }
                        return true
                    })
                    .join('&&')
                console.log(`cmd: ${cmd}`)
                exec(`${cmd}`, (error, stdout, stderr) => {
                    if (error) {
                        console.log(`error:${error}`)
                    }
                })
            })
            .catch((reason) => {
                console.log(reason)
            })
    }

    async say(word: string) {
        if (word.length === 0) {
            return undefined
        }

        const fullPath = `${this.context.globalStorageUri}/${word}.mp3`
        let uri = vscode.Uri.parse(fullPath)

        try {
            const file = await vscode.workspace.fs.readFile(uri)
            return `afplay '${uri.path}'`
        } catch (error) {
            console.error(`文件不存在 ${uri.path}`)
        }

        const doc = await axios(`https://www.ldoceonline.com/dictionary/${word}`, {
            method: 'get',
            responseType: 'document',
            withCredentials: false,
        })

        const $ = cheerio.load(doc.data)
        const resoure = $('.dictentry')?.find('.amefile')?.first()?.attr('data-src-mp3')
        if (!resoure) {
            vscode.window.showWarningMessage(`词典中找不到单词：${word}`)
            throw new Error(`not find word  ==> '${word}'`)
        }

        if (this.statusBarItem) {
            this.statusBarItem.text = `$(sync~spin) 正在联网查询...`
            this.statusBarItem.show()
        }

        try {
            const rs = await axios({
                responseType: 'arraybuffer',
                method: 'get',
                url: resoure,
                headers: {
                    'Content-Type': 'audio/mpeg',
                },
            })
            await vscode.workspace.fs.writeFile(uri, new Buffer(rs.data))
            return `afplay '${uri.path}'`
        } catch (error) {
            vscode.window.showErrorMessage(`${error}`)
        } finally {
            if (this.statusBarItem) {
                this.statusBarItem.hide()
            }
        }
    }

    dispose() {
        this.statusBarItem?.dispose()
        this._disposable.dispose()
    }
}

// this method is called when your extension is deactivated
export function deactivate() {}
