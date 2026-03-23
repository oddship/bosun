-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

-- Clipboard: use OSC 52 to pass yank through tmux to the host terminal.
-- This works inside the bwrap sandbox where wl-copy can't reach the Wayland socket.
vim.opt.clipboard = "unnamedplus"
if os.getenv("TMUX") then
  vim.g.clipboard = {
    name = "OSC 52",
    copy = {
      ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
      ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
    },
    paste = {
      ["+"] = require("vim.ui.clipboard.osc52").paste("+"),
      ["*"] = require("vim.ui.clipboard.osc52").paste("*"),
    },
  }
end

-- Basic settings
vim.g.mapleader = " "
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.termguicolors = true
vim.opt.conceallevel = 2 -- needed for render-markdown

-- Load plugins
require("lazy").setup({
  -- Markdown Preview (render in-neovim)
  {
    "MeanderingProgrammer/render-markdown.nvim",
    opts = {
      file_types = { "markdown", "md" },
      heading = {
        sign = true,
        icons = { "󰲡 ", "󰲣 ", "󰲥 ", "󰲧 ", "󰲩 ", "󰲫 " },
        position = "overlay",
      },
      code = {
        sign = true,
        style = "full",
        position = "left",
        language_pad = 2,
        disable_background = { "diffview", "fugitive", "neo-tree" },
      },
      dash = {
        enabled = true,
        icon = "—",
      },
      bullet = {
        icons = { "●", "○", "◆", "◇" },
      },
      checkbox = {
        checked = { icon = "✅", scope_highlight = "@markup.strikethrough" },
        unchecked = { icon = "⬜" },
      },
      quote = {
        icon = "▎",
        repeat_linebreak = true,
      },
      pipe_table = {
        preset = "round",
      },
    },
    ft = { "markdown", "md" },
  },
})
