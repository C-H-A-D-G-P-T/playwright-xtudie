import ollama from 'ollama';
import { expect } from '@playwright/test'

export class fn {
	// ─── Helpers ────────────────────────────────────────────────────────────────

	async goSubject(page, subjectId) {
		await page.click(
			`//div[@class="vx-card__body"][div/p[contains(text(),"${subjectId}")]]//button[@name="button"]`,
		);
	}

	async getTextAndRemove(page, locator) {
		const text = await page.locator(locator).innerText();
		return text.replace(/["'_]/g, '').trim();
	}

	// ─── AI ─────────────────────────────────────────────────────────────────────

	async buildMessages(page) {
		const question = await this.getTextAndRemove(
			page,
			'//div[@class="text-xl"]',
		);

		const answer1 = await this.getTextAndRemove(
			page,
			'(//span[contains(@class, "choice-text")])[1]',
		);

		const answer2 = await this.getTextAndRemove(
			page,
			'(//span[contains(@class, "choice-text")])[2]',
		);

		// Build choices conditionally so "null" never appears in the prompt
		let choices = `A) ${answer1}\nB) ${answer2}`;

		const answer3Locator = page.locator(
			'(//span[contains(@class, "choice-text")])[3]',
		);
		const answer4Locator = page.locator(
			'(//span[contains(@class, "choice-text")])[4]',
		);

		if (await answer3Locator.isVisible()) {
			const answer3 = await this.getTextAndRemove(
				page,
				'(//span[contains(@class, "choice-text")])[3]',
			);
			choices += `\nC) ${answer3}`;
		}

		if (await answer4Locator.isVisible()) {
			const answer4 = await this.getTextAndRemove(
				page,
				'(//span[contains(@class, "choice-text")])[4]',
			);
			choices += `\nD) ${answer4}`;
		}

		return [
			{
				role: 'system',
				content:
					'คุณเป็นบอทตอบข้อสอบ ให้ตอบเฉพาะตัวอักษร A, B, C หรือ D เท่านั้น โดยไม่ต้องมีเครื่องหมายวงเล็บหรือคำอธิบายใดๆ',
			},
			{
				role: 'user',
				content: `คำถาม: ${question}\nตัวเลือก:\n${choices}\n\nตอบด้วยตัวอักษรเดียวเท่านั้น:`,
			},
		];
	}

	async askAI(messages) {
		try {
			// Using the ollama JS SDK — no manual fetch or JSON needed
			const response = await ollama.chat({
				model: 'qwen2.5:3b',
				messages,
				stream: false,
				options: {
					temperature: 0.0, // fully deterministic
					num_predict: 2, // 1 is sometimes too strict, 2 gives breathing room for token boundary
					top_k: 1, // only pick the single most likely token
					top_p: 1.0, // disable nucleus sampling (redundant when top_k: 1, but explicit)
					repeat_penalty: 1.0, // no penalty needed for single token output
					stop: [')', '\n', ' '], // stop immediately after the letter
				},
			});

			// Normalize: strip anything that isn't A–D
			const raw = response.message.content ?? '';
			const normalized = raw
				.trim()
				.toUpperCase()
				.replace(/[^ABCD]/g, '');

			if (!normalized) throw new Error(`Unexpected AI response: "${raw}"`);

			return normalized;
		} catch (err) {
			console.error('[askAI] Failed:', err.message);
			return 'A'; // safe fallback
		}
	}

	// ─── Quiz loop ───────────────────────────────────────────────────────────────

	async startAnswering(page) {
		// FIX: removed dead `finish` variable; loop now relies solely on the
		//      submit-button check and a question-count guard to prevent infinite loops
		const MAX_QUESTIONS = 100;
		let questionCount = 0;

		while (questionCount < MAX_QUESTIONS) {
			// Check if the final submit button is visible — if so, we're done
			const submitVisible = await page
				.locator('//button//span[text()="ส่งคำตอบ"]')
				.isVisible()
				.catch(() => false);

			if (submitVisible) break;

			// FIX: added this. on getPayload and askAI
			const messages = await this.buildMessages(page);
			const answer = await this.askAI(messages);

			console.log(`[Q${questionCount + 1}] AI answered: ${answer}`);

			const choiceMap = {
				A: '(//span[contains(@class,"choice-text")])[1]',
				B: '(//span[contains(@class,"choice-text")])[2]',
				C: '(//span[contains(@class,"choice-text")])[3]',
				D: '(//span[contains(@class,"choice-text")])[4]',
			};

			if (choiceMap[answer]) {
				await page.locator(choiceMap[answer]).click();
			} else {
				console.warn(
					`[Q${questionCount + 1}] Unrecognised answer "${answer}", defaulting to A`,
				);
				await page.locator(choiceMap['A']).click();
			}

			// FIX: advance to the next question after clicking an answer
			//      without this the loop would re-read the same question forever
			const nextBtn = page.locator(
				'//button[contains(@class,"next") or .//span[text()="ถัดไป"]]',
			);
			const nextVisible = await nextBtn.isVisible().catch(() => false);
			if (nextVisible) {
				await nextBtn.click();
				await page
					.locator('//div[@class="text-xl"]')
					.waitFor({ timeout: 50000 })
					.catch(() => {});
			}

			questionCount++;
		}

		// Click final submit
		await page.locator('//span[text()="ส่งคำตอบ"]').click();

		await expect(page.locator('.feather.feather-star').first()).toBeVisible();

		console.log(
			`[startAnswering] Done — answered ${questionCount} question(s).`,
		);
	}

	// ─── Lesson orchestration ────────────────────────────────────────────────────

	async startLesson(page, lessonNumber) {
		await page
			.locator(`//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]`)
			.nth(0)
			.click();

		const lessonContainer = `//div[@class="p-0 bg-white m-0 w-full"][.//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]]`;

		const pretestBtn = page.locator(
			`${lessonContainer}//span[text()=" เริ่มทำ Pre Test "]`,
		);

		const pretestVisible = await pretestBtn.isVisible().catch(() => false);

		// FIX: check posttest visibility independently and re-locate after DOM changes
		const posttestSelector = `${lessonContainer}//span[text()=" เริ่มทำ Post Test "]`;
		const posttestVisible = await page
			.locator(posttestSelector)
			.isVisible()
			.catch(() => false);

		if (pretestVisible) {
			await pretestBtn.click();
			await page
				.locator('//div[@class="w-full flex justify-center"]//button')
				.click();

			await this.startAnswering(page); // FIX: added this.

			// FIX: re-locate posttestBtn after DOM may have changed post-pretest
			const freshPosttestBtn = page.locator(posttestSelector);
			await freshPosttestBtn.click();
			await page
				.locator('//div[@class="w-full flex justify-center"]//button')
				.click();

			await this.startAnswering(page); // FIX: added this.

			await page
				.locator(`//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]`)
				.nth(0)
				.click();

			console.log(
				`[startLesson] หน่วยการเรียนที่ ${lessonNumber} DONE (Pre + Post)`,
			);
		} else if (posttestVisible) {
			await page.locator(posttestSelector).click();
			await page
				.locator('//div[@class="w-full flex justify-center"]//button')
				.click();

			await this.startAnswering(page); // FIX: added this.

			await page
				.locator(`//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]`)
				.nth(0)
				.click();

			console.log(
				`[startLesson] หน่วยการเรียนที่ ${lessonNumber} DONE (Post only)`,
			);
		} else {
			await page
				.locator(`//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]`)
				.nth(0)
				.click();

			console.log(
				`[startLesson] ไม่พบ Pre Test หรือ Post Test ในหน่วยการเรียนที่ ${lessonNumber}`,
			);
		}
	}
}
