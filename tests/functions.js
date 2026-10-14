import ollama from 'ollama';
import { expect } from '@playwright/test';
import { aiPrompt } from './config.js';

export class fn {
	// ─── Helpers ────────────────────────────────────────────────────────────────

	async goSubject(page, subjectId) {
		await page.click(`//div[@class="vx-card__body"][div/p[contains(text(),"${subjectId}")]]//button[@name="button"]`);
	}

	async getTextAndRemove(page, locator) {
		const text = await page.locator(locator).innerText();
		return text.replace(/["'_]/g, '').trim();
	}

	// ─── AI ─────────────────────────────────────────────────────────────────────

	async buildMessages(page) {
		const question = await this.getTextAndRemove(page, '//div[@class="text-xl"]');

		const choices = [];

		const answerLocators = [
			page.locator('(//span[contains(@class, "choice-text")])[1]'),
			page.locator('(//span[contains(@class, "choice-text")])[2]'),
			page.locator('(//span[contains(@class, "choice-text")])[3]'),
			page.locator('(//span[contains(@class, "choice-text")])[4]'),
		];

		const labels = ['A', 'B', 'C', 'D'];

		for (let i = 0; i < answerLocators.length; i++) {
			if ((await answerLocators[i].count()) > 0) {
				const text = await this.getTextAndRemove(page, `(//span[contains(@class, "choice-text")])[${i + 1}]`);

				choices.push(`${labels[i]}) ${text}`);
			}
		}

		return [
			{
				role: 'system',
				content: `/no_think
	
	คุณเป็นระบบตอบข้อสอบ
	
	กฎ:
	- ตอบได้เฉพาะ A, B, C หรือ D
	- ห้ามอธิบาย
	- ห้ามมีข้อความอื่น
	- ห้ามมีเครื่องหมายวงเล็บ
	- Output ต้องเป็นตัวอักษรภาษาอังกฤษตัวเดียวเท่านั้น`,
			},
			{
				role: 'user',
				content: `คำถาม:
	${question}
	
	ตัวเลือก:
	${choices.join('\n')}
	
	ตอบ:`,
			},
		];
	}

	async askAI(messages) {
		try {
			// Using the ollama JS SDK — no manual fetch or JSON needed
			const response = await ollama.chat(aiPrompt(messages));

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
				console.warn(`[Q${questionCount + 1}] Unrecognised answer "${answer}", defaulting to A`);
				await page.locator(choiceMap['A']).click();
			}

			// FIX: advance to the next question after clicking an answer
			//      without this the loop would re-read the same question forever
			const nextBtn = page.locator('//button[contains(@class,"next") or .//span[text()="ถัดไป"]]');
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

		console.log(`[startAnswering] Done — answered ${questionCount} question(s).`);
	}

	// ─── Lesson orchestration ────────────────────────────────────────────────────

	lessonLocator(page, lessonNumber) {
		return page.locator(`//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]`).first();
	}

	async checkSubmitPreTest(page) {
		await expect(page.locator('//span[text()="ส่งคำตอบ Pre Test เสร็จสิ้น"]')).toBeVisible();
		console.log('Submit Pre Test score successful, keep continue...');
		await page.waitForTimeout(1000);
	}

	async checkSubmitPostTest(page) {
		await expect(page.locator('//span[text()="ส่งคำตอบ Post Test เสร็จสิ้น"]')).toBeVisible();
		console.log('Submit Post Test score successful, keep continue...');
		await page.waitForTimeout(1000);
	}

	async startLesson(page, lessonNumber) {
		await this.lessonLocator(page, lessonNumber).click();

		const lessonContainer = `//div[@class="p-0 bg-white m-0 w-full"][.//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]]`;

		const pretestBtn = page.locator(`${lessonContainer}//span[text()=" เริ่มทำ Pre Test "]`);

		const pretestVisible = await pretestBtn.isVisible().catch(() => false);

		// FIX: check posttest visibility independently and re-locate after DOM changes
		const posttestSelector = `${lessonContainer}//span[text()=" เริ่มทำ Post Test "]`;
		const posttestVisible = await page
			.locator(posttestSelector)
			.isVisible()
			.catch(() => false);

		if (pretestVisible) {
			await pretestBtn.click();
			await page.locator('//div[@class="w-full flex justify-center"]//button').click();

			await this.startAnswering(page); // FIX: added this.
			await this.checkSubmitPreTest(page);

			// FIX: re-locate posttestBtn after DOM may have changed post-pretest
			const freshPosttestBtn = page.locator(posttestSelector);
			await freshPosttestBtn.click();
			await page.locator('//div[@class="w-full flex justify-center"]//button').click();

			await this.startAnswering(page); // FIX: added this.
			await this.checkSubmitPostTest(page);

			await page.locator(`//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]`).nth(0).click();

			console.log(`[startLesson] หน่วยการเรียนที่ ${lessonNumber} DONE (Pre + Post)`);
		} else if (posttestVisible) {
			await page.locator(posttestSelector).click();
			await page.locator('//div[@class="w-full flex justify-center"]//button').click();

			await this.startAnswering(page); // FIX: added this.
			await this.checkSubmitPostTest(page);

			await page.locator(`//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]`).nth(0).click();

			console.log(`[startLesson] หน่วยการเรียนที่ ${lessonNumber} DONE (Post only)`);
		} else {
			await page.locator(`//p[text()=" หน่วยการเรียนที่ ${lessonNumber} "]`).nth(0).click();

			console.log(`[startLesson] ไม่พบ Pre Test หรือ Post Test ในหน่วยการเรียนที่ ${lessonNumber}`);
		}
	}
}
