/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { promisify } from 'util';
import type * as vscode from 'vscode';
import { packageJson } from '../../../../platform/env/common/packagejson';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../../vscodeTypes';
import { ToolName } from '../../common/toolNames';
import { ICopilotTool } from '../../common/toolsRegistry';

const execAsync = promisify(exec);

interface RunInTerminalInput {
	command: string;
	explanation: string;
	isBackground: boolean;
}

/**
 * Test implementation of run_terminal for simulation tests.
 * This tool provides controlled, safe terminal simulation with selective real execution for safe commands.
 */
export class TestTerminalTool implements ICopilotTool<RunInTerminalInput> {
	public static toolName = ToolName.TestRunTerminal;
	readonly info: vscode.LanguageModelToolInformation;
	private static terminalId = 1;
	private readonly executionHistory: Array<{ command: string; timestamp: Date; duration: number; isReal: boolean }> = [];

	// Whitelist of safe commands that can be executed for real
	private static readonly SAFE_COMMANDS = new Set([
		'ls', 'dir', 'pwd', 'whoami', 'date', 'echo', 'cat', 'head', 'tail', 'wc', 'find',
		'git status', 'git log', 'git branch', 'git diff --name-only', 'git remote -v',
		'node --version', 'npm --version', 'tsc --version',
		'which', 'whereis', 'uname', 'hostname'
	]);

	constructor(
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
	) {
		// Build the tool info from package.json like TestEditFileTool does
		const contributedTool = packageJson.contributes.languageModelTools.find(tool =>
			tool.name === 'run_in_terminal' || tool.modelDescription?.includes('run_in_terminal')
		);

		// Use the new custom tool name to avoid conflicts with core run_in_terminal
		this.info = {
			name: ToolName.TestRunTerminal,
			tags: contributedTool?.tags ?? [],
			description: 'This tool allows you to execute shell commands in a persistent terminal session, preserving environment variables, working directory, and other context across multiple commands. [TEST MODE: Safe commands executed for real, others mocked for simulation safety]',
			source: undefined,
			inputSchema: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: 'The command to run in the terminal.'
					},
					explanation: {
						type: 'string',
						description: 'A one-sentence description of what the command does. This will be shown to the user before the command is run.'
					},
					isBackground: {
						type: 'boolean',
						description: 'Whether the command starts a background process. If true, the command will run in the background and you will not see the output. If false, the tool call will block on the command finishing, and then you will get the output. Examples of background processes: building in watch mode, starting a server. You can check the output of a background process later on by using get_terminal_output.'
					}
				},
				required: ['command', 'explanation', 'isBackground']
			}
		};
	}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<RunInTerminalInput>,
		token: vscode.CancellationToken
	): Promise<LanguageModelToolResult> {
		const { command, isBackground } = options.input;

		const startTime = Date.now();
		let output: string;
		let isRealExecution = false;

		try {
			// Check if this is a safe command that we can execute for real
			if (this.isSafeCommand(command)) {
				output = await this.executeRealCommand(command);
				isRealExecution = true;
			} else {
				output = await this.generateMockOutput(command);
				isRealExecution = false;
			}
		} catch (error) {
			// If real execution fails, fall back to mock
			output = await this.generateMockOutput(command);
			isRealExecution = false;
		}

		const actualDuration = Date.now() - startTime;

		// Record execution in history
		this.executionHistory.push({
			command,
			timestamp: new Date(),
			duration: actualDuration,
			isReal: isRealExecution
		});

		const terminalId = TestTerminalTool.terminalId++;
		const executionType = isRealExecution ? '[REAL]' : '[MOCK]';

		if (isBackground) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Started background process with terminal ID: ${terminalId}\nCommand: ${command}\n[TEST MODE: Background process simulated - output will be mocked]`)
			]);
		}

		return new LanguageModelToolResult([
			new LanguageModelTextPart(`Terminal output ${executionType} (${actualDuration}ms):\n\`\`\`\n${output}\n\`\`\``)
		]);
	}

	/**
	 * Check if a command is safe to execute for real
	 */
	private isSafeCommand(command: string): boolean {
		const trimmedCommand = command.trim().toLowerCase();

		// Check for exact matches first
		if (TestTerminalTool.SAFE_COMMANDS.has(trimmedCommand)) {
			return true;
		}

		// Check for pattern matches (commands with arguments)
		for (const safeCmd of TestTerminalTool.SAFE_COMMANDS) {
			if (trimmedCommand.startsWith(safeCmd + ' ') || trimmedCommand === safeCmd) {
				return true;
			}
		}

		// Special cases for commands with time prefix
		if (trimmedCommand.startsWith('time ')) {
			const innerCommand = trimmedCommand.substring(5).trim();
			return this.isSafeCommand(innerCommand);
		}

		return false;
	}

	/**
	 * Execute a real shell command safely
	 */
	private async executeRealCommand(command: string): Promise<string> {
		const workspaceFolders = this.workspaceService.getWorkspaceFolders();
		const cwd = workspaceFolders?.[0]?.fsPath ?? process.cwd();

		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd,
				timeout: 5000, // 5 second timeout for safety
				maxBuffer: 1024 * 100 // 100KB max output
			});

			// Return stdout, or stderr if stdout is empty
			const output = stdout.trim() || stderr.trim();
			return output || `Command executed successfully (no output)`;
		} catch (error: any) {
			// Handle command execution errors gracefully
			if (error.code === 'TIMEOUT') {
				return `Error: Command timed out after 5 seconds`;
			}
			return `Error: ${error.message}\nExit code: ${error.code || 'unknown'}`;
		}
	}

	private async generateMockOutput(command: string): Promise<string> {
		const trimmedCommand = command.trim().toLowerCase();

		// Handle different types of commands with realistic mock outputs
		if (trimmedCommand.startsWith('ls')) {
			return this.mockLsCommand(command);
		}

		if (trimmedCommand.startsWith('echo')) {
			return this.mockEchoCommand(command);
		}

		if (trimmedCommand.startsWith('pwd')) {
			// Use workspace service to get the actual workspace root for realistic output
			const workspaceFolders = this.workspaceService.getWorkspaceFolders();
			return workspaceFolders?.[0]?.fsPath ?? '/home/devcontainers/vscode-copilot-online';
		}

		if (trimmedCommand.startsWith('whoami')) {
			return 'devcontainers';
		}

		if (trimmedCommand.startsWith('date')) {
			return new Date().toString();
		}

		if (trimmedCommand.startsWith('time ')) {
			const innerCommand = command.substring(5);
			const innerOutput = await this.generateMockOutput(innerCommand);
			return `${innerOutput}\n\nreal    0m0.${Math.floor(Math.random() * 100).toString().padStart(2, '0')}s\nuser    0m0.001s\nsys     0m0.002s`;
		}

		if (trimmedCommand.includes('git')) {
			return this.mockGitCommand(command);
		}

		if (trimmedCommand.startsWith('cat ') || trimmedCommand.startsWith('head ') || trimmedCommand.startsWith('tail ')) {
			return 'Mock file content would appear here.\nThis is a simulated file read operation.';
		}

		// Default response for unknown commands
		return `Mock execution of: ${command}\nExit code: 0\nSimulated output for testing purposes.`;
	}

	private mockLsCommand(command: string): string {
		// Simulate typical project directory listing
		const baseFiles = [
			'package.json',
			'tsconfig.json',
			'README.md',
			'src/',
			'test/',
			'node_modules/',
			'.git/',
			'.vscode/'
		];

		if (command.includes('-la') || command.includes('-l')) {
			// Long format listing
			return baseFiles.map(file => {
				const isDir = file.endsWith('/');
				const permissions = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
				const size = isDir ? '4096' : Math.floor(Math.random() * 10000).toString();
				const date = 'Sep 18 13:57';
				return `${permissions} 1 devcontainers devcontainers ${size.padStart(8)} ${date} ${file}`;
			}).join('\n');
		}

		// Simple listing
		return baseFiles.join('\n');
	}

	private mockEchoCommand(command: string): string {
		// Extract the text to echo (handle quotes)
		const match = command.match(/echo\s+(.+)/i);
		if (!match) {
			return '';
		}

		let text = match[1].trim();

		// Remove surrounding quotes if present
		if ((text.startsWith('"') && text.endsWith('"')) ||
			(text.startsWith("'") && text.endsWith("'"))) {
			text = text.slice(1, -1);
		}

		return text;
	}

	private mockGitCommand(command: string): string {
		if (command.includes('status')) {
			return `On branch v0.31.0\nYour branch is up to date with 'origin/v0.31.0'.\n\nnothing to commit, working tree clean`;
		}

		if (command.includes('log')) {
			return `commit abc123def456\nAuthor: Test User <test@example.com>\nDate: ${new Date().toDateString()}\n\n    Mock commit message`;
		}

		if (command.includes('branch')) {
			return `* v0.31.0\n  main\n  develop`;
		}

		return `Mock git output for: ${command}`;
	}

	/**
	 * Get execution history
	 */
	getExecutionHistory(): ReadonlyArray<{ command: string; timestamp: Date; duration: number; isReal: boolean }> {
		return [...this.executionHistory];
	}

	/**
	 * Clear execution history
	 */
	clearHistory(): void {
		this.executionHistory.length = 0;
	}
}