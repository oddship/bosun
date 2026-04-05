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
  {
    "folke/tokyonight.nvim",
    lazy = false,
    priority = 1000,
    config = function()
      require("tokyonight").setup({
        style = "night",
        on_highlights = function(hl, c)
          hl.RenderMarkdownH1 = { fg = c.blue, bold = true }
          hl.RenderMarkdownH2 = { fg = c.magenta, bold = true }
          hl.RenderMarkdownH3 = { fg = c.cyan, bold = true }
          hl.RenderMarkdownH4 = { fg = c.green, bold = true }
          hl.RenderMarkdownH5 = { fg = c.yellow, bold = true }
          hl.RenderMarkdownH6 = { fg = c.orange, bold = true }

          hl.RenderMarkdownCode = { bg = c.bg_dark }
          hl.RenderMarkdownCodeInline = { bg = c.bg_highlight, fg = c.blue1 }

          hl.RenderMarkdownQuote = { fg = c.dark5 }

          hl.RenderMarkdownTableHead = { fg = c.purple, bold = true }
          hl.RenderMarkdownTableRow = { fg = c.fg_gutter }
          hl.RenderMarkdownTableFill = { fg = c.dark3 }

          hl.RenderMarkdownUnchecked = { fg = c.red }
          hl.RenderMarkdownChecked = { fg = c.green }
          hl.RenderMarkdownTodo = { fg = c.orange }

          hl.RenderMarkdownBullet = { fg = c.blue }
          hl.RenderMarkdownDash = { fg = c.comment }
        end,
      })
      vim.cmd.colorscheme("tokyonight-night")
    end,
  },

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
