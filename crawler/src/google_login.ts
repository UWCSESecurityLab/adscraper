import {Entry} from "buttercup";
import {Browser} from "puppeteer";
import {delay} from "./util.js";

export const login = async (browser: Browser, profile: Entry) => {
    const USERNAME = profile.getProperty('username') as string;
    const PASSWORD = profile.getProperty('password') as string;

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);

    await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9,hy;q=0.8'
    });

    await page.goto('https://accounts.google.com/v3/signin/identifier?dsh=S-889076191%3A1667933776610676&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&rip=1&sacu=1&service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin&ifkv=ARgdvAuSj61Lh246-HEq3m7Em3UaLHiy6tAhNcd97cPmo0fl1cb5EDzhcabE4EARC9nhtfOxMzHkvg');

    await page.waitForSelector('input[type="email"]')
    await page.type('input[type="email"]', USERNAME);

    await Promise.all([
        page.waitForNavigation(),
        await page.keyboard.press('Enter')
    ]);

    await delay(2000);

    await page.waitForSelector('input[type="password"]', {visible: true});
    await page.type('input[type="password"]', PASSWORD);
    await page.keyboard.press('Enter')

    await page.waitForNavigation();

    console.log("Google Log In Complete!")
    await page.close();
}