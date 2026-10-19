package com.qrush;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"qrush.scheduling.enabled=false", "spring.jpa.show-sql=false"})
class QRushApplicationTests {

	@Test
	void contextLoads() {
	}

}
