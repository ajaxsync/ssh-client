/** 终端本地行缓冲：按回车切出命令，退格/Ctrl+C 本地处理，其余控制字符忽略 */
export class CommandLineBuffer {
  private buf = ''

  feed(data: string): string[] {
    const submitted: string[] = []
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const cmd = this.buf.trim()
        this.buf = ''
        if (cmd) submitted.push(cmd)
        continue
      }
      if (ch === '\x7f' || ch === '\b') {
        this.buf = this.buf.slice(0, -1)
        continue
      }
      if (ch === '\x03') {
        this.buf = ''
        continue
      }
      if (ch < ' ') continue
      this.buf += ch
    }
    return submitted
  }

  clear(): void {
    this.buf = ''
  }
}

/** SFTP 路径栏：仅以 cd 开头的视为命令，纯路径不记历史 */
export function isSftpCommandInput(raw: string): boolean {
  return /^cd(\s|$)/i.test(raw.trim())
}
