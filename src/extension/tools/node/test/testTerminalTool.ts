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
 * Simplified test implementation of run_terminal for simulation tests.
 * This tool executes all commands directly in the terminal for real.
 */
export class TestTerminalTool implements ICopilotTool<RunInTerminalInput> {
	public static toolName = ToolName.TestRunTerminal;
	readonly info: vscode.LanguageModelToolInformation;
	private static terminalId = 1;

	constructor(
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
	) {
		// Build the tool info from package.json
		const contributedTool = packageJson.contributes.languageModelTools.find(tool =>
			tool.name === 'run_in_terminal' || tool.modelDescription?.includes('run_in_terminal')
		);

		this.info = {
			name: ToolName.TestRunTerminal,
			tags: contributedTool?.tags ?? [],
			description: 'This tool allows you to execute shell commands in a terminal session. All commands are executed for real.',
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

		if (isBackground) {
			// For background processes, start them and return immediately
			const terminalId = TestTerminalTool.terminalId++;
			this.executeCommand(command).catch(() => {
				// Background processes errors are ignored
			});

			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Started background process with terminal ID: ${terminalId}\nCommand: ${command}`)
			]);
		}

		// For non-background commands, wait for completion and return output
		try {
			const output = await this.executeCommand(command);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Terminal output:\n\`\`\`\n${output}\n\`\`\``)
			]);
		} catch (error: any) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error executing command: ${error.message}`)
			]);
		}
	}

	/**
	 * Execute a shell command
	 */
	private async executeCommand(command: string): Promise<string> {
		const workspaceFolders = this.workspaceService.getWorkspaceFolders();
		const cwd = workspaceFolders?.[0]?.fsPath ?? process.cwd();

		const { stdout, stderr } = await execAsync(command, {
			cwd,
			timeout: 30000, // 30 second timeout
			maxBuffer: 1024 * 1024 // 1MB max output
		});

		// Return combined output
		const output = (stdout + stderr).trim();
		return output || `Command executed successfully (no output)`;
	}
}